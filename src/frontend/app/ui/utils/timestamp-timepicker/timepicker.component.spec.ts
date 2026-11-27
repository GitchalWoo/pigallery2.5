import {TimeStampTimePickerComponent} from './timepicker.component';
import {TimeStampDatePickerComponent} from '../timestamp-datepicker/datepicker.component';

// ngModel shows a new value only if its reference changes: changing the Date in place
// kept the picker on the old value when the schedule changed it later (upstream b025d5bc)
describe('timestamp pickers', () => {
  it('gives the time picker a new date for a new time of day', () => {
    const picker = new TimeStampTimePickerComponent();
    const before = picker.date;
    picker.timestamp = 90;
    expect(picker.date).not.toBe(before);
    expect([picker.date.getUTCHours(), picker.date.getUTCMinutes()]).toEqual([1, 30]);
  });

  it('reports the time the user picked', () => {
    const picker = new TimeStampTimePickerComponent();
    const emitted: number[] = [];
    picker.timestampChange.subscribe((v: number) => emitted.push(v));
    picker.onChange(new Date(Date.UTC(2026, 0, 1, 23, 59)));
    expect(picker.timestamp).toBe(23 * 60 + 59);
    expect(emitted).toEqual([23 * 60 + 59]);
  });

  it('gives the date picker a new date for a new timestamp', () => {
    const picker = new TimeStampDatePickerComponent();
    const before = picker.date;
    const ts = Date.UTC(2026, 10, 27, 12, 0);
    picker.timestamp = ts;
    expect(picker.date).not.toBe(before);
    expect(picker.date.getTime()).toBe(ts);
  });
});
