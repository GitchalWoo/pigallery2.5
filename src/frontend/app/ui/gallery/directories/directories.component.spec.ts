import {Component, Input} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {DirectoriesComponent} from './directories.component';
import {DeviceService} from '../../../model/device.service';
import {type SubDirectoryDTO} from '../../../../../common/entities/DirectoryDTO';

@Component({
  selector: 'app-gallery-directory',
  template: '{{ directory.name }}',
})
class StubDirectoryComponent {
  @Input() directory: SubDirectoryDTO;
  @Input() size: number;
}

describe('DirectoriesComponent', () => {
  const directory = (name: string): SubDirectoryDTO => ({path: 'Trips/', name} as SubDirectoryDTO);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DirectoriesComponent],
      providers: [{provide: DeviceService, useValue: {isDesktop: () => true}}],
    });
    TestBed.overrideComponent(DirectoriesComponent, {set: {imports: [StubDirectoryComponent]}});
  });

  it('keeps the folder tiles when the server answer replaces the cached folders', () => {
    const fixture = TestBed.createComponent(DirectoriesComponent);
    fixture.componentInstance.directories = [directory('2025'), directory('2026')];
    fixture.detectChanges();
    const before = Array.from(fixture.nativeElement.querySelectorAll('app-gallery-directory'));

    // the cached folder is shown first, then the fresh server response with new objects
    fixture.componentInstance.directories = [directory('2025'), directory('2026')];
    fixture.detectChanges();
    const after = Array.from(fixture.nativeElement.querySelectorAll('app-gallery-directory'));

    expect(after.length).toBe(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('gives folders without an id (from a disk scan) their own tiles', () => {
    const fixture = TestBed.createComponent(DirectoriesComponent);
    fixture.componentInstance.directories = [directory('2025'), directory('2026')];
    fixture.detectChanges();
    const names = Array.from(fixture.nativeElement.querySelectorAll('app-gallery-directory'))
      .map(e => (e as HTMLElement).textContent);
    expect(names).toEqual(['2025', '2026']);
  });
});
