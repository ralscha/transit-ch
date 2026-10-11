import { getLineBadgePath } from '../line-badge';
import type { TransportMode } from '../transport-api.service';

export interface JourneyLocation {
  id?: string | null;
  name?: string | null;
  coordinate?: { x: number | null; y: number | null } | null;
}

export interface JourneyStop {
  station?: JourneyLocation | null;
  departure?: string | null;
  arrival?: string | null;
  platform?: string | null;
  prognosis?: {
    departure?: string | null;
    arrival?: string | null;
    platform?: string | null;
  } | null;
}

export interface JourneySection {
  departure?: JourneyStop;
  arrival?: JourneyStop;
  walk?: { duration?: number } | null;
  journey?: {
    name?: string;
    category?: string | null;
    number?: string | null;
    to?: string | null;
  } | null;
}

export interface ConnectionDto {
  from?: JourneyStop;
  to?: JourneyStop;
  transfers?: number;
  sections?: JourneySection[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface JourneyLeg {
  kind: 'walk' | 'ride';
  from: string;
  to: string;
  stationId: string | null;
  platform: string | null;
  departure: number | null;
  arrival: number | null;
  minutes: number | null;
  line: string;
  mode: TransportMode;
  badge: string | null;
  direction: string | null;
}

export interface DestinationDeparture {
  id: string;
  stationId: string | null;
  stationName: string;
  distanceMeters: number | null;
  walkingMinutes: number | null;
  departure: number;
  scheduledDeparture: number;
  arrival: number;
  transfers: number;
  platform: string | null;
  line: string;
  mode: TransportMode;
  badge: string | null;
  direction: string | null;
  legs: JourneyLeg[];
}

function timestamp(value: string | null | undefined): number | null {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : null;
}

function time(stop: JourneyStop | undefined, type: 'departure' | 'arrival'): number | null {
  return timestamp(stop?.prognosis?.[type]) ?? timestamp(stop?.[type]);
}

function mode(category: string | null | undefined): TransportMode {
  const value = category?.trim().toUpperCase() ?? '';
  if (!value) return 'unknown';
  if (value.startsWith('BAT') || value.startsWith('SHIP')) return 'boat';
  if (value === 'B' || value.startsWith('BUS')) return 'bus';
  if (value === 'T' || value.startsWith('TRAM')) return 'tram';
  if (['FUN', 'PB', 'GB', 'CC', 'CAB'].some((prefix) => value.startsWith(prefix)))
    return 'cableway';
  return 'rail';
}

function platform(stop: JourneyStop | undefined): string | null {
  return (stop?.prognosis?.platform ?? stop?.platform)?.trim() || null;
}

function leg(section: JourneySection): JourneyLeg {
  const departure = time(section.departure, 'departure');
  const arrival = time(section.arrival, 'arrival');
  const duration = section.walk?.duration;
  const journey = section.journey;
  return {
    kind: journey ? 'ride' : 'walk',
    from: section.departure?.station?.name ?? '',
    to: section.arrival?.station?.name ?? '',
    stationId: section.departure?.station?.id ?? null,
    platform: platform(section.departure),
    departure,
    arrival,
    minutes:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? Math.ceil(duration / 60)
        : departure !== null && arrival !== null && arrival >= departure
          ? Math.ceil((arrival - departure) / 60000)
          : null,
    line: [journey?.category, journey?.number].filter(Boolean).join(' ') || journey?.name || '',
    mode: mode(journey?.category),
    badge: getLineBadgePath(journey?.category, journey?.number),
    direction: journey?.to ?? null,
  };
}

function distance(
  origin: Coordinates | undefined,
  station: JourneyLocation | null | undefined,
): number | null {
  const latitude = station?.coordinate?.x;
  const longitude = station?.coordinate?.y;
  if (
    !origin ||
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const radians = Math.PI / 180;
  const a =
    Math.sin(((latitude - origin.latitude) * radians) / 2) ** 2 +
    Math.cos(origin.latitude * radians) *
      Math.cos(latitude * radians) *
      Math.sin(((longitude - origin.longitude) * radians) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
}

// Rank the first vehicle departures globally, not the journey's initial walk,
// station distance, arrival time, or the order supplied by the planner.
export function nextDepartures(
  connections: ConnectionDto[],
  now: number,
  origin?: Coordinates,
): DestinationDeparture[] {
  const unique = new Map<string, DestinationDeparture>();
  for (const connection of connections) {
    const sections = connection.sections ?? [];
    const firstRideIndex = sections.findIndex((section) => !!section.journey);
    if (firstRideIndex < 0) continue;
    const first = sections[firstRideIndex];
    const departure = time(first.departure, 'departure');
    const scheduledDeparture = timestamp(first.departure?.departure) ?? departure;
    const arrival = time(connection.to ?? sections.at(-1)?.arrival, 'arrival');
    const station = first.departure?.station;
    if (
      departure === null ||
      scheduledDeparture === null ||
      arrival === null ||
      departure < now ||
      arrival < departure ||
      !station?.name
    )
      continue;
    const legs = sections.map(leg);
    const firstLeg = legs[firstRideIndex];
    const walks = legs.slice(0, firstRideIndex);
    const walkingMinutes =
      walks.length === 0
        ? 0
        : walks.every((walk) => walk.minutes !== null)
          ? walks.reduce((total, walk) => total + (walk.minutes ?? 0), 0)
          : null;
    const id = [
      station.id ?? station.name,
      first.journey?.name ?? firstLeg.line,
      scheduledDeparture,
    ].join('|');
    const result: DestinationDeparture = {
      id,
      stationId: station.id ?? null,
      stationName: station.name,
      distanceMeters: distance(origin, station),
      walkingMinutes,
      departure,
      scheduledDeparture,
      arrival,
      transfers:
        Number.isInteger(connection.transfers) && (connection.transfers ?? -1) >= 0
          ? connection.transfers!
          : Math.max(0, legs.filter((item) => item.kind === 'ride').length - 1),
      platform: firstLeg.platform,
      line: firstLeg.line,
      mode: firstLeg.mode,
      badge: firstLeg.badge,
      direction: firstLeg.direction,
      legs,
    };
    const previous = unique.get(id);
    // Several transfer options may share the same departure. Keep its earliest
    // arrival, then prefer fewer changes, instead of filling several rows.
    if (
      !previous ||
      result.arrival < previous.arrival ||
      (result.arrival === previous.arrival && result.transfers < previous.transfers)
    )
      unique.set(id, result);
  }
  return [...unique.values()]
    .sort((a, b) => a.departure - b.departure || a.arrival - b.arrival || a.id.localeCompare(b.id))
    .slice(0, 5);
}
