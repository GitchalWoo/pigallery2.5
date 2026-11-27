import {expect} from 'chai';
import {request} from 'chai-http';
import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import {type UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {NotificationManager} from '../../../../src/backend/model/NotifocationManager';
import {type NotificationDTO, NotificationType} from '../../../../src/common/entities/NotificationDTO';
import {DBTestHelper} from '../../DBTestHelper';

process.env.NODE_ENV = 'test';

DBTestHelper.describe()('NotificationRouter', (database) => {
  const member: UserDTO = {id: undefined, name: 'member', password: 'test-member-password', role: UserRoles.User};
  const warningText = 'Using default admin user!';
  let server: Server;
  let notifications: NotificationDTO[];
  let requireAuthentication: boolean;
  let suppressWarning: boolean;

  beforeEach(() => {
    notifications = NotificationManager.notifications;
    requireAuthentication = Config.Users.authenticationRequired;
    suppressWarning = Config.Users.suppressDefUserWarn;
    NotificationManager.notifications = [];
  });

  afterEach(async () => {
    await database.clearDB();
    NotificationManager.notifications = notifications;
    Config.Users.authenticationRequired = requireAuthentication;
    Config.Users.suppressDefUserWarn = suppressWarning;
  });

  async function startServer(suppressDefUserWarn = false) {
    await database.initDB();
    Config.Users.authenticationRequired = true;
    Config.Users.suppressDefUserWarn = suppressDefUserWarn;
    NotificationManager.notifications = [];
    // Exercise the warning for a deliberately seeded legacy account, using the server's test fixture.
    await SQLConnection.init();
    const users = ObjectManagers.getInstance().UserManager;
    await users.createUser({...member});
    server = new Server(false);
    await server.onStarted.wait();
  }

  async function readAs(username: string, password: string): Promise<NotificationDTO[]> {
    const agent = request.agent(server.Server);
    try {
      const login = await agent.post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {username, password, rememberMe: false}});
      expect(login.status).to.equal(200);
      const response = await agent.get(Config.Server.apiPath + '/notifications');
      expect(response.status).to.equal(200);
      expect(response.body.error).to.equal(null);
      return response.body.result;
    } finally {
      agent.close();
    }
  }

  it('shows legacy default-password details to admins and a generic notice to members', async () => {
    await startServer();
    const warning = (await readAs('admin', 'admin')).find(notification => notification.message === warningText);
    expect(warning).to.include({type: NotificationType.error});
    expect(warning.details).to.contain('password');
    expect(await readAs(member.name, member.password)).to.deep.equal(NotificationManager.HasNotification);
  });

  it('honors the default-password warning setting', async () => {
    await startServer(true);
    expect((await readAs('admin', 'admin')).map(notification => notification.message)).not.to.include(warningText);
  });
});
