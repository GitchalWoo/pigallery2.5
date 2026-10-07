import { NgModule } from '@angular/core';
import {
  RouterModule,
  type Routes,
  type UrlMatchResult,
  UrlSegment,
} from '@angular/router';
import { LoginComponent } from './ui/login/login.component';
import { ShareLoginComponent } from './ui/sharelogin/share-login.component';
import { QueryParams } from '../../common/QueryParams';
import { AuthGuard } from './model/network/helper/auth.guard';
import { ErrorComponent } from './ui/error/error.component';

export function galleryMatcherFunction(
  segments: UrlSegment[]
): UrlMatchResult | null {
  if (segments.length === 0) {
    return null;
  }
  const path = segments[0].path;

  const posParams: { [key: string]: UrlSegment } = {};
  if (path === 'gallery') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.directory] = segments[1];
    }
    return {
      consumed: segments.slice(0, Math.min(segments.length, 2)),
      posParams,
    };
  }
  if (path === 'search') {
    if (segments.length > 1) {
      posParams[QueryParams.gallery.search.query] = segments[1];
    }
    return {
      consumed: segments.slice(0, Math.min(segments.length, 2)),
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
    component: LoginComponent,
  },
  {
    path: 'shareLogin',
    component: ShareLoginComponent,
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./ui/admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [AuthGuard],
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
    matcher: galleryMatcherFunction,
    loadComponent: () =>
      import('./ui/gallery/gallery.component').then(
        (m) => m.GalleryComponent
      ),
    canActivate: [AuthGuard],
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/error', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
