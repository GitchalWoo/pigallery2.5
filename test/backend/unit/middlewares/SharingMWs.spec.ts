import {expect} from 'chai';
import {SharingMWs} from '../../../../src/backend/middlewares/SharingMWs';
import {Config} from '../../../../src/common/config/private/Config';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {Request, Response} from 'express';

describe('SharingMWs', () => {
  let originalSharingEnabled: boolean;

  beforeEach(() => {
    originalSharingEnabled = Config.Sharing.enabled;
    Config.Sharing.enabled = true;
    Config.Sharing.passwordRequired = false;
  });

  afterEach(() => {
    Config.Sharing.enabled = originalSharingEnabled;
  });

  describe('createSharing - AUD5 key generation loop bounds', () => {
    it('should successfully create share when key is unused on first attempt', async () => {
      let findOneCalled = 0;
      let createdShare: any = null;

      const mockSharingManager: any = {
        findOne: async (key: string): Promise<any> => {
          findOneCalled++;
          return null; // Key not in use
        },
        createSharing: async (sharing: any): Promise<any> => {
          createdShare = sharing;
          return {id: 1, ...sharing};
        }
      };

      (ObjectManagers.getInstance() as any).SharingManager = mockSharingManager;

      const req: any = {
        body: {
          createSharing: {
            valid: 1000
          }
        },
        params: {
          directory: '/photos'
        },
        session: {
          context: {
            user: {id: 1, name: 'admin'}
          }
        }
      };

      let errorResult: any = null;
      const res: any = {};
      const next = (err?: any) => {
        errorResult = err;
      };

      await SharingMWs.createSharing(req as Request, res as Response, next);

      expect(errorResult).to.be.undefined;
      expect(findOneCalled).to.equal(1);
      expect(req.resultPipe).to.exist;
      expect(req.resultPipe.sharingKey).to.be.a('string');
      expect(createdShare.sharingKey).to.equal(req.resultPipe.sharingKey);
    });

    it('should retry on collision and succeed when unused key is found', async () => {
      let findOneCalled = 0;

      const mockSharingManager: any = {
        findOne: async (key: string): Promise<any> => {
          findOneCalled++;
          if (findOneCalled <= 3) {
            return {id: 99, sharingKey: key}; // Collision for first 3 tries
          }
          return null; // Free on 4th try
        },
        createSharing: async (sharing: any): Promise<any> => {
          return {id: 2, ...sharing};
        }
      };

      (ObjectManagers.getInstance() as any).SharingManager = mockSharingManager;

      const req: any = {
        body: {createSharing: {valid: 1000}},
        params: {directory: '/test'},
        session: {context: {user: {id: 1}}}
      };

      let errorResult: any = null;
      const res: any = {};
      const next = (err?: any) => {
        errorResult = err;
      };

      await SharingMWs.createSharing(req as Request, res as Response, next);

      expect(errorResult).to.be.undefined;
      expect(findOneCalled).to.equal(4);
      expect(req.resultPipe).to.exist;
      expect(req.resultPipe.sharingKey).to.be.a('string');
    });

    it('should terminate and return GENERAL_ERROR when 10 collisions occur (no infinite loop)', async () => {
      let findOneCalled = 0;

      const mockSharingManager: any = {
        findOne: async (key: string): Promise<any> => {
          findOneCalled++;
          return {id: 100, sharingKey: key}; // Always collides
        },
        createSharing: async (sharing: any): Promise<any> => {
          return {id: 3, ...sharing};
        }
      };

      (ObjectManagers.getInstance() as any).SharingManager = mockSharingManager;

      const req: any = {
        body: {createSharing: {valid: 1000}},
        params: {directory: '/test'},
        session: {context: {user: {id: 1}}}
      };

      let errorResult: any = null;
      const res: any = {};
      const next = (err?: any) => {
        errorResult = err;
      };

      await SharingMWs.createSharing(req as Request, res as Response, next);

      expect(findOneCalled).to.equal(10);
      expect(errorResult).to.be.instanceOf(ErrorDTO);
      expect(errorResult.code).to.equal(ErrorCodes.GENERAL_ERROR);
      expect(errorResult.message).to.include('Failed to generate unique sharing key');
    });

    it('should propagate database error if findOne fails', async () => {
      const mockSharingManager: any = {
        findOne: async (): Promise<any> => {
          throw new Error('Database connection lost');
        }
      };

      (ObjectManagers.getInstance() as any).SharingManager = mockSharingManager;

      const req: any = {
        body: {createSharing: {valid: 1000}},
        params: {directory: '/test'},
        session: {context: {user: {id: 1}}}
      };

      let errorResult: any = null;
      const res: any = {};
      const next = (err?: any) => {
        errorResult = err;
      };

      await SharingMWs.createSharing(req as Request, res as Response, next);

      expect(errorResult).to.be.instanceOf(ErrorDTO);
      expect(errorResult.code).to.equal(ErrorCodes.GENERAL_ERROR);
    });
  });
});
