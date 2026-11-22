import {Injectable} from '@angular/core';
import {NetworkService} from '../../model/network/network.service';
import {type CreateSharingDTO, type PublicSharingDTO, type ResponseSharingDTO,} from '../../../../common/entities/SharingDTO';
import {Router, RoutesRecognized} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {QueryParams} from '../../../../common/QueryParams';
import {type UserDTO, UserRoles} from '../../../../common/entities/UserDTO';
import {Utils} from '../../../../common/Utils';
import {Config} from '../../../../common/config/public/Config';
import {type DirectorySearch, type SearchQueryDTO, TextSearchQueryMatchTypes} from '../../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';


@Injectable()
export class ShareService {
  public readonly UnknownSharingKey = {
    sharingKey: 'UnknownSharingKey'
  } as ResponseSharingDTO;
  param: string = null;
  queryParam: string = null;
  sharingKey: string = null;
  inited = false;
  public ReadyPR: Promise<void>;
  public sharingSubject: BehaviorSubject<ResponseSharingDTO> = new BehaviorSubject(
    null
  );
  public sharingIsValid: BehaviorSubject<boolean> = new BehaviorSubject(
    null
  );
  private resolve: () => void;
  public publicSharingSubject: BehaviorSubject<PublicSharingDTO> = new BehaviorSubject(
    null
  );

  constructor(private networkService: NetworkService, private router: Router) {
    this.ReadyPR = new Promise((resolve: () => void) => {
      if (this.inited === true) {
        return resolve();
      }
      this.resolve = resolve;
    });

    this.router.events.subscribe(async (val) => {
      if (val instanceof RoutesRecognized) {
        this.param =
          val.state.root.firstChild.params[
            QueryParams.gallery.sharingKey_params
            ] || null;
        this.queryParam =
          val.state.root.firstChild.queryParams[
            QueryParams.gallery.sharingKey_query
            ] || null;

        const key = this.param || this.queryParam;
        if (key && key !== this.sharingKey) {
          this.setSharingKey(key);
          await this.checkSharing();
        }
        if (this.resolve) {
          this.resolve();
          this.resolve = null;
          this.inited = true;
        }
      }
    });
  }

  public getUrl(share: ResponseSharingDTO): string {
    return Utils.concatUrls(Config.Server.publicUrl, Config.Server.urlBase, '/share/', share.sharingKey);
  }


  onNewUser = async (user: UserDTO) => {
    // if this is a sharing user or a logged-in user, get sharing key
    if (user?.usedSharingKey || user?.role > UserRoles.LimitedGuest) {
      const key = this.param || this.queryParam || user.usedSharingKey || this.getSharingKey();
      if (key !== this.sharingKey || this.sharingSubject.value == null) {
        this.setSharingKey(key);
        if (!this.sharingKey) { //no key to fetch
          return;
        }
        await this.getSharing();
      }
      if (this.resolve) {
        this.resolve();
        this.resolve = null;
        this.inited = true;
      }
    }
  };

  public wait(): Promise<void> {
    if (this.inited) {
      return Promise.resolve();
    }
    return this.ReadyPR;
  }

  public createSharing(
    dir: string,
    password: string,
    valid: number
  ): Promise<ResponseSharingDTO> {
    // The server converts the legacy path to an exact directory query.
    return this.networkService.postJson('/share/' + dir, {
      createSharing: {
        valid,
        ...(!!password && {password: password}) // only add password if present
      } as CreateSharingDTO,
    });
  }

  public createSharingByQuery(
    searchQuery: SearchQueryDTO,
    password: string,
    valid: number
  ): Promise<ResponseSharingDTO> {
    return this.networkService.postJson('/share/', {
      createSharing: {
        valid,
        ...(!!password && {password: password}),
        searchQuery
      } as CreateSharingDTO,
    });
  }

  public updateSharing(
    dir: string,
    sharingId: number,
    password: string,
    valid: number
  ): Promise<ResponseSharingDTO> {
    // The server converts the legacy path to an exact directory query.
    return this.networkService.putJson('/share/' + dir, {
      updateSharing: {
        id: sharingId,
        valid,
        password,
      } as CreateSharingDTO,
    });
  }

  public updateSharingByQuery(
    sharingId: number,
    searchQuery: SearchQueryDTO,
    password: string,
    valid: number
  ): Promise<ResponseSharingDTO> {
    return this.networkService.putJson('/share/', {
      updateSharing: {
        id: sharingId,
        valid,
        password,
        searchQuery
      } as CreateSharingDTO,
    });
  }

  public getSharingKey(): string {
    return this.sharingKey;
  }

  public createSharingByDirectory(
    directoryQuery: DirectorySearch, password: string, valid: number, defaultDirectoryView: string
  ): Promise<ResponseSharingDTO> {
    return this.networkService.postJson('/share/', {
      createSharing: {directoryQuery, searchQuery: null, ...(password && {password}), valid, defaultDirectoryView} satisfies CreateSharingDTO
    });
  }

  public updateSharingByDirectory(
    id: number, directoryQuery: DirectorySearch, password: string, valid: number, defaultDirectoryView: string
  ): Promise<ResponseSharingDTO> {
    return this.networkService.putJson('/share/', {
      updateSharing: {id, directoryQuery, password, valid, defaultDirectoryView}
    });
  }

  public getDefaultRoute(sharing: ResponseSharingDTO): string[] | null {
    if (sharing?.defaultDirectoryView) {
      return ['/gallery', SearchQueryUtils.normalizeDirectoryPath(sharing.defaultDirectoryView)];
    }
    const search = sharing?.defaultSearchView || sharing?.searchQuery;
    if (search) {
      return ['/search', SearchQueryUtils.urlify(search)];
    }
    if (sharing?.directoryQuery) {
      const query = sharing.directoryQuery;
      const path = SearchQueryUtils.normalizeDirectoryPath(query.value);
      if (query.matchType === TextSearchQueryMatchTypes.globMatch) {
        return ['/gallery', path === '*' ? '' : path.replace(/\/\*$/, '')];
      }
      return ['/gallery', path];
    }
    return null;
  }

  public dropSharing(): void {
    this.param = null;
    this.queryParam = null;
    this.setSharingKey(null);
  }

  public async getPublicSharing(): Promise<PublicSharingDTO | null> {
    const key = this.getSharingKey();
    if (!key) {
      return null;
    }
    if (this.publicSharingSubject.value?.sharingKey !== key) {
      await this.checkSharing();
    }
    return this.getSharingKey() === key ? this.publicSharingSubject.value : null;
  }

  public async getCurrentSharing(): Promise<ResponseSharingDTO | null> {
    const key = this.getSharingKey();
    if (!key) {
      return null;
    }
    if (this.sharingSubject.value?.sharingKey !== key) {
      await this.getSharing();
    }
    return this.getSharingKey() === key ? this.sharingSubject.value : null;
  }

  private setSharingKey(key: string): void {
    if (key === this.sharingKey) {
      return;
    }
    this.sharingKey = key;
    this.sharingSubject.next(null);
    this.publicSharingSubject.next(null);
    this.sharingIsValid.next(null);
  }

  public isSharing(): boolean {
    return this.sharingKey != null;
  }

  public async getSharingListForQuery(
    query: SearchQueryDTO
  ): Promise<ResponseSharingDTO[]> {
    return this.networkService.getJson('/share/list/' + encodeURIComponent(JSON.stringify(query)));
  }

  public getSharingList(): Promise<ResponseSharingDTO[]> {
    if (!Config.Sharing.enabled) {
      return Promise.resolve([]);
    }
    return this.networkService.getJson('/share/listAll');
  }

  public deleteSharing(sharing: ResponseSharingDTO): Promise<void> {
    return this.networkService.deleteJson('/share/' + encodeURIComponent(sharing.sharingKey));
  }

  private async getSharing(): Promise<void> {
    const key = this.getSharingKey();
    try {
      this.sharingSubject.next(null);
      const sharing = await this.networkService.getJson<ResponseSharingDTO>(
        '/share/' + encodeURIComponent(key)
      );
      if (this.getSharingKey() === key) {
        this.sharingSubject.next(sharing);
      }
    } catch (e) {
      if (this.getSharingKey() === key) {
        this.sharingSubject.next(this.UnknownSharingKey);
      }
      console.error(e);
    }
  }

  private async checkSharing(): Promise<void> {
    const key = this.getSharingKey();
    this.publicSharingSubject.next(null);
    this.sharingIsValid.next(null);
    try {
      const sharing = await this.networkService.getJson<PublicSharingDTO>(
        '/share/' + encodeURIComponent(key) + '/publicInfo'
      );
      if (this.getSharingKey() === key) {
        const valid = sharing?.sharingKey === key;
        this.publicSharingSubject.next(valid ? sharing : null);
        this.sharingIsValid.next(valid);
      }
    } catch (e) {
      if (this.getSharingKey() === key) {
        this.publicSharingSubject.next(null);
        this.sharingIsValid.next(false);
      }
      console.error(e);
    }
  }
}
