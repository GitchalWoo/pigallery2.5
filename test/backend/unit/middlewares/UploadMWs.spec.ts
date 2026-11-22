import {expect} from 'chai';
import {UploadMWs} from '../../../../src/backend/middlewares/UploadMWs';
import {DirectoryAccessTypes} from '../../../../src/backend/model/DirectoryAccess';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';

declare const describe: any;
declare const it: any;

describe('UploadMWs', () => {

  /**
   * The request has no body stream: multer would fail (or wait) on it,
   * so a quick DIRECTORY_NOT_FOUND shows the body was not read.
   */
  const callUpload = async (directoryAccess?: DirectoryAccessTypes) => {
    const req: any = {params: {directory: 'private'}, directoryAccess};
    let status: number = null;
    const res: any = {
      status: (s: number) => {
        status = s;
        return res;
      }
    };
    let nextArgs: any[] = null;
    await UploadMWs.upload(req, res, (...args: any[]) => {
      nextArgs = args;
    });
    return {status, nextArgs};
  };

  it('rejects a folder whose content the user can not see before reading the body', async () => {
    for (const access of [undefined, DirectoryAccessTypes.none, DirectoryAccessTypes.parent]) {
      const r = await callUpload(access);
      expect(r.status, String(access)).to.equal(404);
      expect(r.nextArgs, String(access)).to.deep.equal([new ErrorDTO(ErrorCodes.DIRECTORY_NOT_FOUND, 'Directory not found')]);
    }
  });

  it('does not take an upload slot for a rejected folder', async () => {
    // more rejected requests than MAX_CONCURRENT_UPLOADS (5): none of them may answer 'too many uploads'
    for (let i = 0; i < 8; ++i) {
      const r = await callUpload(DirectoryAccessTypes.parent);
      expect((r.nextArgs[0] as ErrorDTO).code).to.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
    }
  });
});
