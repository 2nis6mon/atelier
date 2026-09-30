import { describe, expect, it } from 'vitest';
import {
  dateKey,
  findDateRange,
  findSingleDate,
  formatPartialDate,
  formatRange,
  isValidPartialDate,
  makePartialDate,
  monthOf,
  parseDateToken,
  rangesOverlap,
  yearOf,
} from '../../src/shared/dates';

describe('partial dates', () => {
  it('validates stored formats', () => {
    expect(isValidPartialDate('')).toBe(true);
    expect(isValidPartialDate('2022')).toBe(true);
    expect(isValidPartialDate('2022-09')).toBe(true);
    expect(isValidPartialDate('2022-13')).toBe(false);
    expect(isValidPartialDate('1800')).toBe(false);
    expect(isValidPartialDate('22')).toBe(false);
  });

  it('parses French and English tokens', () => {
    expect(parseDateToken('sept. 2022')).toBe('2022-09');
    expect(parseDateToken('Février 2020')).toBe('2020-02');
    expect(parseDateToken('Sep 2022')).toBe('2022-09');
    expect(parseDateToken('03/2018')).toBe('2018-03');
    expect(parseDateToken('2018-3')).toBe('2018-03');
    expect(parseDateToken('2021')).toBe('2021');
    expect(parseDateToken("aujourd'hui")).toBe('present');
    expect(parseDateToken('Present')).toBe('present');
    expect(parseDateToken('Smarch 2020')).toBeNull();
    expect(parseDateToken('13/2020')).toBeNull();
    expect(parseDateToken('2020-14')).toBeNull();
    expect(parseDateToken('')).toBeNull();
    expect(parseDateToken('hello')).toBeNull();
  });

  it('formats per language', () => {
    expect(formatPartialDate('2022-09', 'fr')).toBe('sept. 2022');
    expect(formatPartialDate('2022-09', 'en')).toBe('Sep 2022');
    expect(formatPartialDate('2022', 'en')).toBe('2022');
    expect(formatPartialDate('', 'en')).toBe('');
    expect(formatRange('2022', '', true, 'fr')).toBe("2022 – aujourd'hui");
    expect(formatRange('2020', '2022', false, 'en')).toBe('2020 – 2022');
    expect(formatRange('2020', '2020', false, 'en')).toBe('2020');
    expect(formatRange('', '2019', false, 'en')).toBe('2019');
    expect(makePartialDate(2020)).toBe('2020');
    expect(yearOf('x')).toBeNull();
    expect(monthOf('2020')).toBeNull();
    expect(dateKey('')).toBe(0);
  });

  it('finds ranges in free text', () => {
    expect(findDateRange("2022 – aujourd'hui   Atelier Nova")).toMatchObject({ start: '2022', end: '', current: true });
    expect(findDateRange('Sep 2022 – Present | Paris')).toMatchObject({ start: '2022-09', current: true });
    expect(findDateRange('janv. 2019 - déc. 2021')).toMatchObject({ start: '2019-01', end: '2021-12', current: false });
    expect(findDateRange('De 2015 à 2017 chez Lumen')).toMatchObject({ start: '2015', end: '2017' });
    expect(findDateRange('03/2018 – 06/2020')).toMatchObject({ start: '2018-03', end: '2020-06' });
    expect(findDateRange('Depuis 2021')).toMatchObject({ start: '2021', current: true });
    expect(findDateRange('Since March 2020')).toMatchObject({ start: '2020-03', current: true });
    expect(findDateRange('No dates here')).toBeNull();
    expect(findSingleDate('Master — 2019')).toMatchObject({ date: '2019' });
    expect(findSingleDate('none')).toBeNull();
  });

  it('detects overlapping periods', () => {
    expect(rangesOverlap({ start: '2020', end: '2022', current: false }, { start: '2021', end: '', current: true })).toBe(true);
    expect(rangesOverlap({ start: '2015', end: '2016', current: false }, { start: '2019', end: '2020', current: false })).toBe(false);
    expect(rangesOverlap({ start: '2020-01', end: '2020-06', current: false }, { start: '2020-06', end: '', current: true })).toBe(true);
  });
});
