import {TestBed} from '@angular/core/testing';
import {ActivatedRoute, convertToParamMap} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {UserRoles} from '../../../../common/entities/UserDTO';
import {NavigationService} from '../../model/navigation.service';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ShareService} from '../gallery/share.service';
import {InvalidSharingComponent} from './invalid-sharing.component';

describe('InvalidSharingComponent', () => {
  const setup = (retry: boolean, usedSharingKey?: string) => {
    const user = new BehaviorSubject({name: 'user', role: UserRoles.User, usedSharingKey});
    const dropSharing = vi.fn();
    const toDefault = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [InvalidSharingComponent],
      providers: [
        {provide: ActivatedRoute, useValue: {snapshot: {queryParamMap: convertToParamMap(retry ? {retry: '1'} : {})}}},
        {provide: AuthenticationService, useValue: {user}},
        {provide: NavigationService, useValue: {toDefault}},
        {provide: ShareService, useValue: {dropSharing}},
      ],
    });
    const fixture = TestBed.createComponent(InvalidSharingComponent);
    fixture.detectChanges();
    return {element: fixture.nativeElement as HTMLElement, dropSharing, toDefault};
  };

  it('gives a share guest the invalid-link message with no gallery action', () => {
    const {element} = setup(false, 'key');
    expect(element.textContent).toContain('This link is invalid or has expired.');
    expect(element.querySelector('button')).toBeNull();
  });

  it('offers the visible URL for retry and lets account users return to their own gallery', () => {
    const {element, dropSharing, toDefault} = setup(true);
    expect(element.querySelector('a')?.href).toBe(window.location.href);
    element.querySelector('button')?.click();
    expect(dropSharing).toHaveBeenCalledOnce();
    expect(toDefault).toHaveBeenCalledOnce();
  });
});
