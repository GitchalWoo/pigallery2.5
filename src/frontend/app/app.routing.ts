import { NgModule } from '@angular/core';
import {
  RouterModule,
  type Routes,
  type UrlMatchResult,
  UrlSegment,
} from '@angular/router';
import {loadLoginComponent} from './themes/theme-templates';
import { ShareLoginComponent } from './ui/sharelogin/share-login.component';
import { QueryParams } from '../../common/QueryParams';
import { AdminGuard, AuthGuard } from './model/network/helper/auth.guard';
import { ErrorComponent } from './ui/error/error.component';
import {ShareGuard} from './model/network/helper/share.guard';
import {NavigationService} from './model/navigation.service';

export function galleryMatcherFunction(
  segments: UrlSegment[]
): UrlMatchResult | null {
  if (segments.length === 0) {
    return null;
  }
  const path = segments[0].path;

  const posParams: Record<string, UrlSegment> = {};
  if (path === 'gallery' || path === 'search') {
    const parameter = path === 'gallery' ? QueryParams.gallery.directory : QueryParams.gallery.search.query;
    if (segments.length > 1) {
      // The public router also serves nested links whose slashes were left unencoded.
      posParams[parameter] = segments.length === 2 ? segments[1] :
        new UrlSegment(segments.slice(1).map(segment => segment.path).join('/'), {});
    }
    return {
      consumed: segments,
      posParams,
    };
  }
  if (path === 'share') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.sharingKey_params] = segments[1];
    }
    return {
      consumed: segments.slice(0, Math.min(segments.length, 2)),
      posParams,
    };
  }
  return null;
}

const routes: Routes = [
  {
    path: 'login',
    loadComponent: loadLoginComponent,
  },
  {
    path: 'shareLogin',
    component: ShareLoginComponent,
    canActivate: [ShareGuard],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./ui/admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [AdminGuard],
  },
  {
    path: 'duplicates',
    loadComponent: () =>
      import('./ui/duplicates/duplicates.component').then(
        (m) => m.DuplicateComponent
      ),
    canActivate: [AuthGuard],
  },
  {
    path: 'albums',
    loadComponent: () =>
      import('./ui/albums/albums.component').then((m) => m.AlbumsComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'faces',
    loadComponent: () =>
      import('./ui/faces/faces.component').then((m) => m.FacesComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'timeline',
    loadComponent: () =>
      import('./ui/timeline/timeline.component').then(
        (m) => m.TimelineComponent
      ),
    canActivate: [AuthGuard],
  },
  {
    path: 'error',
    component: ErrorComponent,
  },
  {
    path: NavigationService.shareProblemPath,
    loadComponent: () => import('./ui/invalid-sharing/invalid-sharing.component').then(m => m.InvalidSharingComponent),
  },
  {
    matcher: galleryMatcherFunction,
    loadComponent: () =>
      import('./ui/gallery/gallery.component').then(
        (m) => m.GalleryComponent
      ),
    canActivate: [ShareGuard],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: '**',
    data: {notFound: true},
    loadComponent: () => import('./ui/not-found/not-found.component').then(m => m.NotFoundComponent),
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
