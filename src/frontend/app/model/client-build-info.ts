export interface ClientBuildInfo {
  appVersion: string;
  buildTime: string;
  buildCommitHash?: string;
}

export function logClientBuild(build?: ClientBuildInfo): void {
  if (build) {
    console.info(`PiGallery2.5 client ${build.appVersion}, built ${build.buildTime}, commit ${build.buildCommitHash || 'unknown'}`);
  } else {
    console.info('PiGallery2.5 client: dev build');
  }
}
