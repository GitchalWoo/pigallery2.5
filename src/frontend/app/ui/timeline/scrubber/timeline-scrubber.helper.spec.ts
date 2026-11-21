import {
  bucketAtFraction,
  buildScrubberModel,
  fractionForMonth,
} from './timeline-scrubber.helper';

describe('timeline-scrubber.helper', () => {
  it('returns empty model for null or empty summary', () => {
    expect(buildScrubberModel(null)).toEqual({buckets: [], ticks: []});
    expect(buildScrubberModel({years: []})).toEqual({buckets: [], ticks: []});
  });

  it('orders buckets newest-first with proportional fractions covering [0, 1]', () => {
    const model = buildScrubberModel({
      years: [
        {year: 2022, months: [{month: 1, count: 4}, {month: 12, count: 9}]},
        {year: 2024, months: [{month: 6, count: 16}, {month: 3, count: 1}]},
      ],
    });

    expect(model.buckets.map(b => b.key)).toEqual(['2024-06', '2024-03', '2022-12', '2022-01']);
    expect(model.buckets[0].startFraction).toBe(0);
    expect(model.buckets[model.buckets.length - 1].endFraction).toBeCloseTo(1, 6);
    // sqrt weights: 4, 1, 3, 2 => total 10
    expect(model.buckets[0].endFraction).toBeCloseTo(0.4, 6);
    expect(model.buckets[1].endFraction).toBeCloseTo(0.5, 6);
    expect(model.buckets[2].endFraction).toBeCloseTo(0.8, 6);

    const years = model.ticks.filter(t => t.kind === 'year');
    expect(years.map(t => ({year: t.year, fraction: t.fraction}))).toEqual([
      {year: 2024, fraction: 0},
      {year: 2022, fraction: 0.5},
    ]);
    // Intermediate months in tall spans get subtle dots.
    const dots = model.ticks.filter(t => t.kind === 'dot');
    expect(dots.map(d => d.key)).toEqual(['2024-03', '2022-01']);
  });

  it('maps fractions and month keys accurately across boundaries', () => {
    const model = buildScrubberModel({
      years: [
        {year: 2023, months: [{month: 5, count: 9}]},
        {year: 2024, months: [{month: 10, count: 9}]},
      ],
    });

    expect(bucketAtFraction(model.buckets, -0.5)?.key).toBe('2024-10');
    expect(bucketAtFraction(model.buckets, 0)?.key).toBe('2024-10');
    expect(bucketAtFraction(model.buckets, 0.25)?.key).toBe('2024-10');
    expect(bucketAtFraction(model.buckets, 0.75)?.key).toBe('2023-05');
    expect(bucketAtFraction(model.buckets, 1)?.key).toBe('2023-05');
    expect(bucketAtFraction(model.buckets, 2)?.key).toBe('2023-05');

    expect(fractionForMonth(model.buckets, '2024-10')).toBeCloseTo(0.25, 6);
    expect(fractionForMonth(model.buckets, '2023-05')).toBeCloseTo(0.75, 6);
    expect(fractionForMonth(model.buckets, '1999-01')).toBeNull();
  });

  it('hides overlapping year labels and spaces dots cleanly when many tiny years are packed', () => {
    const years = Array.from({length: 40}, (_, i) => ({
      year: 1985 + i,
      months: [{month: 1, count: 1}],
    }));
    const model = buildScrubberModel({years});
    const yearTicks = model.ticks.filter(t => t.kind === 'year');
    expect(yearTicks.length).toBeGreaterThan(5);
    expect(yearTicks.length).toBeLessThan(25);
    // Ticks should be strictly sorted and never collide.
    for (let i = 1; i < model.ticks.length; i++) {
      expect(model.ticks[i].fraction).toBeGreaterThan(model.ticks[i - 1].fraction);
    }
  });
});
