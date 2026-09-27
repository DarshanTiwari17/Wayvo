/**
 * Wayvo digital twin — the simulation model.
 *
 * A digital twin is only useful if it is *internally consistent*: every number
 * on the page has to add up to every other number. So the rules below are
 * deliberately strict about that:
 *
 *   - The corridor delays are a distribution of the single headline delay
 *     figure. They sum to it exactly (largest-remainder rounding), so the
 *     breakdown can never contradict the summary.
 *   - Every disruption quotes the delay of the corridor it sits on. It cannot
 *     claim a delay the corridor does not have.
 *   - Risk is derived from the modelled outcome (delay, hazards, threatened
 *     connections) rather than read straight off the weather input, so a long
 *     severe storm and a short severe storm are not scored identically.
 *   - Everything is a pure function of its input. No clock, no randomness, no
 *     network. The same inputs always produce the same twin, which is what
 *     makes it testable and what makes "compare two scenarios" meaningful.
 *
 * This file deliberately imports nothing. Keeping the model free of Supabase
 * and of React is what allows `npm run test:digital-twin` to exercise it in
 * isolation, and it keeps the "real data" concerns (`twinBaseline.ts`) and the
 * "what-if maths" concerns strictly apart.
 */

export type WeatherIntensity = 'none' | 'light' | 'moderate' | 'heavy' | 'extreme'
export type RouteStatus = 'normal' | 'affected' | 'critical'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type HazardKind = 'rain' | 'flood' | 'ice' | 'congestion' | 'visibility' | 'heat'
export type ActionUrgency = 'now' | 'soon' | 'monitor'
export type ConnectionStatus = 'none' | 'ok' | 'at-risk' | 'broken'

/** The four inputs the traveller controls. */
export type TwinScenario = {
  weatherIntensity: WeatherIntensity
  durationHours: number
  temperatureC: number
  location: string
}

/**
 * One corridor being stressed. Supplied by the caller so the twin can run over
 * a real itinerary (one entry per booking) or, when no trip is in scope, over
 * the generic network shape in `GENERIC_CORRIDORS`.
 */
export type TwinCorridorInput = {
  id: string
  label: string
  detail?: string | null
  /** Real scheduled minutes for this leg, when they are known. */
  baseMinutes?: number | null
  /**
   * Real minutes available to change trains/buses here, when known. This is
   * what turns a delay into a missed connection.
   */
  connectionMinutes?: number | null
  /**
   * Relative share of the network delay this corridor absorbs. Only used when
   * `baseMinutes` is unknown; known durations speak for themselves.
   */
  weight?: number | null
  /**
   * How exposed this corridor is to the weather, relative to the rest.
   * 1 = average, above 1 = drains or clears worse. Real itineraries carry no
   * exposure data, so they use 1 and the model leans on duration instead.
   */
  exposure?: number | null
}

export type TwinCorridor = {
  id: string
  label: string
  detail: string
  status: RouteStatus
  /** Scheduled minutes. 0 when the traveller has no saved duration. */
  baseMinutes: number
  /** True when `baseMinutes` was allocated by the model, not read from a booking. */
  estimatedBase: boolean
  delayMinutes: number
  simulatedMinutes: number
  delayPercent: number
  /** Delay relative to the average corridor: 1 = a typical share. */
  delayVsAverage: number
  hazards: HazardKind[]
  connectionMinutes: number | null
  connectionStatus: ConnectionStatus
}

export type DigitalTwinDisruption = {
  id: string
  label: string
  segment: string
  severity: 'info' | 'warn' | 'critical'
  delayMinutes: number
  impact: string
  hazard: HazardKind
}

export type TwinAction = {
  id: string
  label: string
  detail: string
  urgency: ActionUrgency
}

export type DigitalTwinSimulation = {
  scenario: TwinScenario
  /** The scenario as one readable sentence, e.g. "Heavy rain for 3h at 17°C". */
  weatherChange: string
  weatherIntensity: WeatherIntensity

  /** Scheduled travel time for the corridor set being simulated. */
  baselineTravelMinutes: number
  simulatedTravelMinutes: number
  delayMinutes: number
  delayPercent: number

  routeStatus: RouteStatus
  riskLevel: RiskLevel
  /** The raw 0-100 figure riskLevel and resilienceScore are derived from. */
  riskScore: number
  /** 100 - riskScore, clamped. One number for "how much slack is left". */
  resilienceScore: number

  hazards: HazardKind[]
  corridors: TwinCorridor[]
  worstCorridor: TwinCorridor | null
  disruptions: DigitalTwinDisruption[]
  disruptionCount: number

  atRiskConnections: number
  brokenConnections: number
  recommendedBufferMinutes: number

  alternativeRoute: string
  recoveryPlan: string
  actions: TwinAction[]
  impactSummary: string
}

/* ==========================================================================
   Scenario vocabulary
   ========================================================================== */

export const WEATHER_INTENSITY_OPTIONS: Array<{
  value: WeatherIntensity
  label: string
  title: string
  description: string
}> = [
  { value: 'none', label: 'None', title: 'Clear conditions', description: 'No rainfall' },
  { value: 'light', label: 'Light', title: 'Light rain', description: 'Patchy showers' },
  { value: 'moderate', label: 'Moderate', title: 'Moderate rain', description: 'Steady rain' },
  { value: 'heavy', label: 'Heavy', title: 'Heavy rain', description: 'Intense rainfall' },
  { value: 'extreme', label: 'Extreme', title: 'Extreme rain', description: 'Severe downpour' },
]

export const HAZARD_LABELS: Record<HazardKind, string> = {
  rain: 'Rain',
  flood: 'Flooding',
  ice: 'Ice',
  congestion: 'Congestion',
  visibility: 'Poor visibility',
  heat: 'Extreme heat',
}

export const LOCATIONS = [
  'Central District',
  'North Junction',
  'River Corridor',
  'West Bypass',
  'Coastal Approach',
] as const

export const DEFAULT_LOCATION = LOCATIONS[0]

/** Slider bounds, in one place so the model and the UI can never disagree. */
export const DURATION_RANGE = { min: 1, max: 12, step: 1 } as const
export const TEMPERATURE_RANGE = { min: -10, max: 40, step: 1 } as const

export const DEFAULT_SCENARIO: TwinScenario = {
  weatherIntensity: 'heavy',
  durationHours: 3,
  temperatureC: 17,
  location: DEFAULT_LOCATION,
}

/**
 * Named starting points. A blank form asks the traveller to imagine five
 * separate things; a preset asks one question ("what happens in a storm?")
 * and they can then adjust from a concrete scenario.
 */
export const SCENARIO_PRESETS: Array<{ id: string; label: string; description: string; scenario: TwinScenario }> = [
  {
    id: 'clear',
    label: 'Clear skies',
    description: 'Baseline — nothing changes',
    scenario: { weatherIntensity: 'none', durationHours: 3, temperatureC: 17, location: DEFAULT_LOCATION },
  },
  {
    id: 'steady',
    label: 'Steady rain',
    description: 'Moderate, 3 hours',
    scenario: { weatherIntensity: 'moderate', durationHours: 3, temperatureC: 14, location: 'River Corridor' },
  },
  {
    id: 'storm',
    label: 'Heavy storm',
    description: 'Heavy rain, 4 hours',
    scenario: { weatherIntensity: 'heavy', durationHours: 4, temperatureC: 16, location: 'Central District' },
  },
  {
    id: 'flood',
    label: 'Flood risk',
    description: 'Extreme rain, 6 hours',
    scenario: { weatherIntensity: 'extreme', durationHours: 6, temperatureC: 19, location: 'Coastal Approach' },
  },
  {
    id: 'freeze',
    label: 'Freeze',
    description: 'Moderate rain near 0°C',
    scenario: { weatherIntensity: 'moderate', durationHours: 3, temperatureC: 0, location: 'North Junction' },
  },
]

/**
 * The generic network used when no real trip is in scope.
 *
 * `weight` is the share of the trip that section represents; `exposure` is how
 * badly it copes with rain (residential streets drain fast, a low-lying final
 * approach does not). Without exposure every corridor would degrade by exactly
 * the same proportion and the breakdown would say nothing.
 */
export const GENERIC_CORRIDORS: TwinCorridorInput[] = [
  { id: 'origin-access', label: 'Origin access', detail: 'Getting to the first departure point', weight: 0.2, exposure: 0.8 },
  { id: 'city-corridor', label: 'City corridor', detail: 'Main urban approach through the network', weight: 0.3, exposure: 1.25 },
  { id: 'interchange', label: 'Transit interchange', detail: 'Where the legs change', weight: 0.25, exposure: 1 },
  { id: 'destination-leg', label: 'Destination leg', detail: 'Last mile to the final stop', weight: 0.25, exposure: 1.4 },
]

/* ==========================================================================
   Model constants
   ========================================================================== */

/**
 * Share of the scheduled travel time lost purely because of rainfall
 * intensity, before duration, temperature and connections are considered.
 * Calibrated so the headline "heavy rain" case lands in the `high` band and
 * "extreme rain" reaches `critical`.
 */
const INTENSITY_DELAY_FACTOR: Record<WeatherIntensity, number> = {
  none: 0,
  light: 0.12,
  moderate: 0.26,
  heavy: 0.44,
  extreme: 0.68,
}

/** Wet-road share of the worst-case intensity, used to scale icing. */
const INTENSITY_WETNESS: Record<WeatherIntensity, number> = {
  none: 0,
  light: 0.18,
  moderate: 0.38,
  heavy: 0.65,
  extreme: 1,
}

/**
 * Exposure saturates rather than growing without limit: the first hour of rain
 * costs the most, and hour twelve is barely worse than hour six. Modelled as a
 * rising curve that asymptotes at 0.22.
 */
const DURATION_MAX_FACTOR = 0.22
const DURATION_TAU_HOURS = 4

/** Icing starts at the wet-road threshold and is fully developed well below it. */
const ICE_START_C = 2
const ICE_FULL_C = -10
const ICE_MAX_FACTOR = 0.3
const MAX_ICE_RISK_POINTS = 20

/** Heat only bites above a genuinely hot threshold, and only mildly. */
const HEAT_START_C = 28
const HEAT_FULL_C = 40
const HEAT_MAX_FACTOR = 0.1

/** Never model a journey as more than ~2x its scheduled time. */
export const MAX_DELAY_RATIO = 0.95

/**
 * Corridor severity, measured as a share of the *average* corridor's delay.
 * 1 = a typical share of the damage, so these numbers are independent of how
 * long the journey is and defined even for corridors with no saved duration.
 */
const CORRIDOR_CRITICAL_RELATIVE = 1.6
/** A flooded or iced corridor is critical at a lower threshold. */
const CORRIDOR_FLOOD_CRITICAL_RELATIVE = 1
const CORRIDOR_ICE_CRITICAL_RELATIVE = 1.2

/** Risk score bands. */
const RISK_MEDIUM = 20
const RISK_HIGH = 45
const RISK_CRITICAL = 70

/** A connection is "at risk" once the delay eats half the changeover window… */
const CONNECTION_WARN_RATIO = 0.5
/** …and "broken" once it eats all of it. */
const CONNECTION_BREAK_RATIO = 1

const MAX_CONNECTIONS_RISK_POINTS = 24
const MAX_BUFFER_MINUTES = 90

/** At most this many corridors are reported as disruptions, worst first. */
const MAX_DISRUPTIONS = 4

/* ==========================================================================
   Small pure helpers
   ========================================================================== */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** "2h 15m", "45m", "0m" — durations are never shown as bare minutes. */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0))
  if (safe < 60) return `${safe}m`
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function weatherIntensityLabel(value: WeatherIntensity): string {
  return WEATHER_INTENSITY_OPTIONS.find((option) => option.value === value)?.label ?? 'None'
}

/** Sentence-ready name, e.g. "Heavy rain" — never "None rain". */
export function weatherIntensityTitle(value: WeatherIntensity): string {
  return WEATHER_INTENSITY_OPTIONS.find((option) => option.value === value)?.title ?? 'Clear conditions'
}

export function routeStatusLabel(status: RouteStatus): string {
  return status === 'critical' ? 'Critical' : status === 'affected' ? 'Affected' : 'Normal'
}

export function riskLevelLabel(level: RiskLevel): string {
  return titleCase(level)
}

export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'broken':
      return 'Connection lost'
    case 'at-risk':
      return 'Tight connection'
    case 'ok':
      return 'Connection holds'
    default:
      return 'No changeover'
  }
}

/** "3h" / "1h" — used inside the scenario sentence. */
export function formatDurationHours(hours: number): string {
  const safe = clamp(Math.round(hours), DURATION_RANGE.min, DURATION_RANGE.max)
  return `${safe}h`
}

/**
 * Which temperature hazard bands a reading falls into. Shared with the UI so
 * the hint under the temperature slider can never disagree with the model.
 *
 * Icing needs a wet road, or a genuinely hard freeze with nothing falling.
 */
export function temperatureEffect(
  temperatureC: number,
  intensity: WeatherIntensity = 'none',
): { icing: boolean; icingBand: boolean; heat: boolean } {
  const icingBand = temperatureC <= ICE_START_C
  return {
    icingBand,
    icing: (icingBand && intensity !== 'none') || temperatureC <= -2,
    heat: temperatureC >= HEAT_START_C,
  }
}

/**
 * Splits `total` across `weights` so the parts are whole minutes and sum to
 * exactly `total`. Plain proportional rounding would drift by a few minutes
 * and make the breakdown disagree with the headline figure; the largest-
 * remainder method does not.
 */
export function distributeInteger(total: number, weights: number[]): number[] {
  const parts = weights.map((weight) => (isPositiveNumber(weight) ? weight : 0))
  const sum = parts.reduce((total_, weight) => total_ + weight, 0)
  const safeTotal = Math.max(0, Math.round(Number.isFinite(total) ? total : 0))

  if (parts.length === 0) return []
  if (safeTotal === 0) return parts.map(() => 0)
  if (sum <= 0) {
    // No usable weights: share it out evenly, still summing to the total.
    const base = Math.floor(safeTotal / parts.length)
    const out = parts.map(() => base)
    for (let index = 0; index < safeTotal - base * parts.length; index += 1) out[index] += 1
    return out
  }

  const exact = parts.map((weight) => (weight / sum) * safeTotal)
  const out = exact.map(Math.floor)
  let remainder = safeTotal - out.reduce((a, b) => a + b, 0)
  if (remainder > 0) {
    const byRemainder = exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      // Ties break on index so the result stays deterministic run to run.
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    for (let step = 0; step < byRemainder.length && remainder > 0; step += 1) {
      out[byRemainder[step].index] += 1
      remainder -= 1
    }
  }
  return out
}

/**
 * Rounds a set of already-computed shares back to whole minutes so they still
 * sum to the original total. Used when the shares have been scaled by
 * something other than their weights (exposure, for instance), where
 * `distributeInteger` cannot be applied directly.
 */
export function distributeIntegerFromExact(exact: number[]): number[] {
  const out = exact.map((value) => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)))
  let remainder = out.reduce((sum, value) => sum + value, 0)
  const target = exact.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  const wanted = Math.max(0, Math.round(target))
  remainder = wanted - remainder
  if (remainder === 0) return out

  if (remainder < 0) {
    // Over-allocated (only possible through floating point): take minutes back
    // from the largest shares first.
    let toRemove = -remainder
    const order = exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => a.fraction - b.fraction || a.index - b.index)
    for (let step = 0; step < order.length && toRemove > 0; step += 1) {
      if (out[order[step].index] > 0) {
        out[order[step].index] -= 1
        toRemove -= 1
      }
    }
    return out
  }

  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let step = 0; step < byRemainder.length && remainder > 0; step += 1) {
    out[byRemainder[step].index] += 1
    remainder -= 1
  }
  return out
}

/* ==========================================================================
   Hazard derivation
   ========================================================================== */

function durationDelayFactor(durationHours: number): number {
  const hours = clamp(durationHours, DURATION_RANGE.min, DURATION_RANGE.max)
  // Saturating: 1h adds nothing beyond the intensity, 12h approaches 0.22.
  return DURATION_MAX_FACTOR * (1 - Math.exp(-Math.max(0, hours - 1) / DURATION_TAU_HOURS))
}

function iceDelayFactor(intensity: WeatherIntensity, temperatureC: number): number {
  if (temperatureC > ICE_START_C) return 0
  // A dry night below freezing still produces black ice, so the floor is not 0.
  const severity = clamp((ICE_START_C - temperatureC) / (ICE_START_C - ICE_FULL_C), 0, 1)
  const wetness = INTENSITY_WETNESS[intensity]
  return ICE_MAX_FACTOR * severity * (0.35 + 0.65 * wetness)
}

function heatDelayFactor(temperatureC: number): number {
  if (temperatureC < HEAT_START_C) return 0
  const severity = clamp((temperatureC - HEAT_START_C) / (HEAT_FULL_C - HEAT_START_C), 0, 1)
  return HEAT_MAX_FACTOR * severity
}

/**
 * Icing risk, scored separately from the time it costs.
 *
 * A dry hard freeze barely slows anyone down — the roads are mostly clear — but
 * the black ice that is there is genuinely dangerous. Scoring risk off the
 * delay would therefore under-report a freeze, so this is its own measure.
 */
function iceRiskPoints(intensity: WeatherIntensity, temperatureC: number): number {
  if (temperatureC > ICE_START_C) return 0
  const severity = clamp((ICE_START_C - temperatureC) / (ICE_START_C - ICE_FULL_C), 0, 1)
  // Wet and freezing is much worse than dry and freezing.
  const exposure = 0.45 + 0.55 * INTENSITY_WETNESS[intensity]
  return Math.min(MAX_ICE_RISK_POINTS, MAX_ICE_RISK_POINTS * severity * exposure)
}

function deriveHazards(intensity: WeatherIntensity, temperatureC: number): HazardKind[] {
  const hazards: HazardKind[] = []

  if (intensity !== 'none') {
    hazards.push('rain')
    if (intensity === 'moderate' || intensity === 'heavy' || intensity === 'extreme') hazards.push('congestion')
    if (intensity === 'heavy' || intensity === 'extreme') hazards.push('flood')
    if (intensity === 'extreme') hazards.push('visibility')
  }

  // Icing needs either a wet road or a genuinely hard freeze.
  const wetAndCold = intensity !== 'none' && temperatureC <= ICE_START_C
  const dryAndFrozen = intensity === 'none' && temperatureC <= -2
  if (wetAndCold || dryAndFrozen) hazards.push('ice')

  if (temperatureC >= HEAT_START_C) hazards.push('heat')

  return hazards
}

const HAZARD_COPY: Record<HazardKind, (corridorLabel: string, minutes: number) => string> = {
  rain: (corridor) => `Standing water and reduced traction on ${corridor} stretch braking distance.`,
  flood: (corridor) => `Surface water is collecting on ${corridor}; low-lying stretches are impassable.`,
  ice: (corridor) => `Freezing conditions on ${corridor} leave black ice on untreated surfaces.`,
  congestion: (corridor) => `Demand outstrips capacity on ${corridor}, so average speed drops.`,
  visibility: (corridor) => `Spray and low visibility on ${corridor} force speed reductions.`,
  heat: (corridor) => `Heat on ${corridor} causes vehicle slowdown and hotter braking systems.`,
}

const HAZARD_TITLES: Record<HazardKind, (corridorLabel: string) => string> = {
  rain: (corridor) => `Road waterlogging on ${corridor}`,
  flood: (corridor) => `Flood risk on ${corridor}`,
  ice: (corridor) => `Ice on ${corridor}`,
  congestion: (corridor) => `Queue buildup on ${corridor}`,
  visibility: (corridor) => `Visibility loss on ${corridor}`,
  heat: (corridor) => `Overheating on ${corridor}`,
}

/* ==========================================================================
   Corridors
   ========================================================================== */

function normaliseCorridors(corridors?: TwinCorridorInput[]): TwinCorridorInput[] {
  const usable = (corridors ?? []).filter((corridor) => Boolean(corridor?.id))
  return usable.length > 0 ? usable : GENERIC_CORRIDORS
}

function corridorWeight(corridor: TwinCorridorInput, fallback: number): number {
  if (isPositiveNumber(corridor.baseMinutes)) return corridor.baseMinutes
  if (isPositiveNumber(corridor.weight)) return corridor.weight
  return fallback
}

function corridorExposure(corridor: TwinCorridorInput): number {
  return isPositiveNumber(corridor.exposure) ? (corridor.exposure as number) : 1
}

/**
 * Corridor severity.
 *
 * Comparing a corridor's delay against its *own* duration is the obvious
 * measure, but it is undefined for a corridor with no saved duration — and it
 * would mark a two-minute walk "critical" on a five-minute network. So
 * severity is driven by the delay relative to the average corridor instead,
 * which is defined for every corridor whether or not its duration is known.
 * Duration is still used for the percentage shown to the traveller.
 */
function corridorStatus(relativeToAverage: number, delayMinutes: number, hazards: HazardKind[]): RouteStatus {
  if (delayMinutes <= 0) return 'normal'
  if (relativeToAverage >= CORRIDOR_CRITICAL_RELATIVE) return 'critical'
  if (hazards.includes('flood') && relativeToAverage >= CORRIDOR_FLOOD_CRITICAL_RELATIVE) return 'critical'
  if (hazards.includes('ice') && relativeToAverage >= CORRIDOR_ICE_CRITICAL_RELATIVE) return 'critical'
  return 'affected'
}

function connectionStatusFor(delayMinutes: number, connectionMinutes: number | null): ConnectionStatus {
  if (!isPositiveNumber(connectionMinutes)) return 'none'
  if (delayMinutes >= connectionMinutes * CONNECTION_BREAK_RATIO) return 'broken'
  if (delayMinutes >= connectionMinutes * CONNECTION_WARN_RATIO) return 'at-risk'
  return 'ok'
}

/**
 * Allocates the scheduled travel time across the corridors that have no real
 * duration of their own, so a corridor can still say "about 10 minutes
 * scheduled" instead of showing nothing. The remainder is split by weight, and
 * the result is flagged `estimatedBase` so the UI can disclose it.
 */
function allocateBaseMinutes(inputs: TwinCorridorInput[], baselineMinutes: number): number[] {
  const known = inputs.map((corridor) => (isPositiveNumber(corridor.baseMinutes) ? Math.round(corridor.baseMinutes) : 0))
  const unknown = known.map((value, index) => (value === 0 ? index : -1)).filter((index) => index >= 0)
  if (unknown.length === 0) return known

  const remaining = Math.max(0, baselineMinutes - known.reduce((sum, value) => sum + value, 0))
  const shares = distributeInteger(remaining, unknown.map((index) => corridorWeight(inputs[index], 1 / unknown.length)))
  const out = [...known]
  unknown.forEach((index, position) => {
    out[index] = shares[position] ?? 0
  })
  return out
}

function buildCorridors(inputs: TwinCorridorInput[], delayMinutes: number, baselineMinutes: number, hazards: HazardKind[]): TwinCorridor[] {
  const count = inputs.length

  // Delay is distributed by duration (or weight) *and* exposure, then rounded
  // so the parts still sum to exactly the headline figure.
  const rawWeights = inputs.map((corridor) => corridorWeight(corridor, 1 / count) * corridorExposure(corridor))
  const rawTotal = rawWeights.reduce((sum, weight) => sum + weight, 0)
  const scaled = rawTotal > 0 ? rawWeights.map((weight) => (weight / rawTotal) * delayMinutes) : inputs.map(() => 0)
  const delays = distributeIntegerFromExact(scaled)

  const bases = allocateBaseMinutes(inputs, baselineMinutes)
  const averageDelay = count > 0 ? delayMinutes / count : 0

  return inputs.map((corridor, index) => {
    const corridorDelay = delays[index] ?? 0
    const hasRealBase = isPositiveNumber(corridor.baseMinutes)
    const baseMinutes = bases[index] ?? 0
    const relativeToAverage = averageDelay > 0 ? corridorDelay / averageDelay : 0

    return {
      id: corridor.id,
      label: corridor.label,
      detail: corridor.detail?.trim() || 'Modelled corridor',
      status: corridorStatus(relativeToAverage, corridorDelay, hazards),
      baseMinutes,
      estimatedBase: !hasRealBase,
      delayMinutes: corridorDelay,
      simulatedMinutes: baseMinutes + corridorDelay,
      delayPercent: hasRealBase && baseMinutes > 0 ? Math.round((corridorDelay / baseMinutes) * 100) : Math.round(relativeToAverage * 100),
      delayVsAverage: round(relativeToAverage, 2),
      hazards: hazards.slice(),
      connectionMinutes: isPositiveNumber(corridor.connectionMinutes) ? Math.round(corridor.connectionMinutes as number) : null,
      connectionStatus: connectionStatusFor(corridorDelay, isPositiveNumber(corridor.connectionMinutes) ? Math.round(corridor.connectionMinutes as number) : null),
    }
  })
}

/* ==========================================================================
   Risk
   ========================================================================== */

function floodRiskPoints(intensity: WeatherIntensity): number {
  if (intensity === 'extreme') return 12
  if (intensity === 'heavy') return 7
  return 0
}

function riskLevelFor(score: number): RiskLevel {
  if (score >= RISK_CRITICAL) return 'critical'
  if (score >= RISK_HIGH) return 'high'
  if (score >= RISK_MEDIUM) return 'medium'
  return 'low'
}

function routeStatusFor(riskLevel: RiskLevel): RouteStatus {
  if (riskLevel === 'critical') return 'critical'
  if (riskLevel === 'high' || riskLevel === 'medium') return 'affected'
  return 'normal'
}

function urgencyFor(riskLevel: RiskLevel): ActionUrgency {
  if (riskLevel === 'critical') return 'now'
  if (riskLevel === 'high') return 'soon'
  return 'monitor'
}

/* ==========================================================================
   Disruptions
   ========================================================================== */

function buildDisruptions(corridors: TwinCorridor[], hazards: HazardKind[]): DigitalTwinDisruption[] {
  const affected = corridors
    .filter((corridor) => corridor.status !== 'normal' && corridor.delayMinutes > 0)
    .sort((a, b) => b.delayMinutes - a.delayMinutes || a.label.localeCompare(b.label))

  return affected.slice(0, MAX_DISRUPTIONS).map((corridor, index) => {
    // The headline hazard for this corridor, worst first.
    const hazard =
      (corridor.hazards.includes('flood') && 'flood') ||
      (corridor.hazards.includes('ice') && 'ice') ||
      (corridor.hazards.includes('visibility') && 'visibility') ||
      (corridor.hazards.includes('congestion') && 'congestion') ||
      (corridor.hazards.includes('rain') && 'rain') ||
      (corridor.hazards.includes('heat') && 'heat') ||
      hazards[0] ||
      'rain'

    return {
      id: `${corridor.id}-${hazard}-${index}`,
      label: HAZARD_TITLES[hazard](corridor.label),
      segment: corridor.detail,
      severity: corridor.status === 'critical' ? 'critical' : corridor.status === 'affected' ? 'warn' : 'info',
      // Quoted straight from the corridor, so the two can never disagree.
      delayMinutes: corridor.delayMinutes,
      impact: HAZARD_COPY[hazard](corridor.label, corridor.delayMinutes),
      hazard,
    }
  })
}

/* ==========================================================================
   Narrative
   ========================================================================== */

function buildAlternativeRoute(
  intensity: WeatherIntensity,
  hazards: HazardKind[],
  worst: TwinCorridor | null,
  bufferMinutes: number,
): string {
  if (intensity === 'none' && hazards.length === 0) {
    return 'Keep the direct route and the original departure plan.'
  }
  const target = worst ? worst.label.toLowerCase() : 'the affected corridor'

  if (hazards.includes('flood')) {
    return `Hold ${target} and divert via the western ring road. It sits above the flood line and stays open in heavy rain.`
  }
  if (hazards.includes('ice')) {
    return `Use the gritted arterial route instead of ${target}. Side streets and bridges are not treated once temperatures drop this low.`
  }
  if (hazards.includes('heat')) {
    return `Take the shaded arterial route around ${target} and add a cooling stop; vehicle systems slow down in this heat.`
  }
  if (hazards.includes('congestion')) {
    return `Shift departure by ${bufferMinutes} min to clear the ${target} peak, then rejoin the original route.`
  }
  return `Keep the direct route and add a ${bufferMinutes} min buffer — ${target} is the slowest section under rain.`
}

function buildActions(input: {
  riskLevel: RiskLevel
  hazards: HazardKind[]
  worst: TwinCorridor | null
  delayMinutes: number
  bufferMinutes: number
  atRiskConnections: number
  brokenConnections: number
  alternativeRoute: string
  simulatedMinutes: number
  baselineMinutes: number
}): TwinAction[] {
  const urgency = urgencyFor(input.riskLevel)
  const actions: TwinAction[] = []
  const target = input.worst?.label ?? 'the affected corridor'

  if (input.brokenConnections > 0) {
    actions.push({
      id: 'rebook-connections',
      label: `Rebook ${input.brokenConnections} lost connection${input.brokenConnections === 1 ? '' : 's'}`,
      detail:
        'The modelled delay is longer than the changeover window on this itinerary, so the onward leg cannot be caught. Move to the next service or reroute around the delay.',
      urgency: 'now',
    })
  } else if (input.atRiskConnections > 0) {
    actions.push({
      id: 'protect-connections',
      label: `Protect ${input.atRiskConnections} tight connection${input.atRiskConnections === 1 ? '' : 's'}`,
      detail: `The delay reaches over half the changeover window on ${target}. Standby for the next service and tell the traveller before the window closes.`,
      urgency,
    })
  }

  if (input.hazards.includes('flood')) {
    actions.push({
      id: 'flood-reroute',
      label: 'Divert off the flood-prone section',
      detail: input.alternativeRoute,
      urgency: urgency === 'monitor' ? 'soon' : urgency,
    })
  }

  if (input.hazards.includes('ice')) {
    actions.push({
      id: 'ice-margin',
      label: 'Add winterised braking margin',
      detail:
        'Temperatures here put untreated surfaces at risk of black ice. Increase following distance, prefer main roads and check the forecast before departure.',
      urgency,
    })
  }

  if (input.hazards.includes('heat')) {
    actions.push({
      id: 'heat-margin',
      label: 'Build in heat tolerance',
      detail: 'Expect slower acceleration and hotter braking. Add a stop and keep water available for the traveller.',
      urgency,
    })
  }

  if (input.delayMinutes > 0) {
    actions.push({
      id: 'departure-buffer',
      label: `Add a ${input.bufferMinutes} min departure buffer`,
      detail: `Scheduled ${formatMinutes(input.baselineMinutes)} becomes ${formatMinutes(input.simulatedMinutes)} in this scenario. Leaving ${input.bufferMinutes} min earlier absorbs most of the difference.`,
      urgency,
    })
  }

  if (urgency !== 'monitor') {
    actions.push({
      id: 'notify-traveller',
      label: 'Send the revised arrival time now',
      detail:
        'The traveller should not learn about this at the platform. Push the new ETA and the reason for it as soon as the scenario is adopted.',
      urgency,
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: 'monitor',
      label: 'Keep the current plan and monitor conditions',
      detail: 'This scenario does not move the network. Re-run it when the forecast changes.',
      urgency: 'monitor',
    })
  }

  return actions
}

function buildImpactSummary(input: {
  intensity: WeatherIntensity
  delayMinutes: number
  delayPercent: number
  baselineMinutes: number
  corridors: TwinCorridor[]
  atRiskConnections: number
  brokenConnections: number
  routeStatus: RouteStatus
}): string {
  if (input.delayMinutes <= 0) {
    return 'No weather disruption is expected. Every corridor stays normal and travel time is unchanged.'
  }

  const affected = input.corridors.filter((corridor) => corridor.status !== 'normal')
  const critical = affected.filter((corridor) => corridor.status === 'critical')
  const parts: string[] = [
    `${weatherIntensityTitle(input.intensity)} adds ${input.delayMinutes} min (${input.delayPercent}%) to a ${formatMinutes(input.baselineMinutes)} trip, which moves the network into ${routeStatusLabel(input.routeStatus).toLowerCase()} mode.`,
  ]

  if (affected.length > 0) {
    const worst = [...affected].sort((a, b) => b.delayMinutes - a.delayMinutes)[0]
    parts.push(
      `${affected.length} of ${input.corridors.length} corridors are affected` +
        (critical.length > 0 ? ` and ${critical.length} ${critical.length === 1 ? 'is' : 'are'} critical` : '') +
        `, worst on ${worst.label} at +${worst.delayMinutes} min.`,
    )
  }

  if (input.brokenConnections > 0) {
    parts.push(`${input.brokenConnections} connection${input.brokenConnections === 1 ? '' : 's'} cannot be made.`)
  } else if (input.atRiskConnections > 0) {
    parts.push(`${input.atRiskConnections} changeover${input.atRiskConnections === 1 ? ' is' : 's are'} at risk.`)
  }

  return parts.join(' ')
}

function buildRecoveryPlan(actions: TwinAction[], riskLevel: RiskLevel, routeStatus: RouteStatus): string {
  if (actions.length === 1 && actions[0].id === 'monitor') return actions[0].detail
  const lead = actions[0]
  return `${actions.length}-step response (${riskLevel} risk, ${routeStatusLabel(routeStatus).toLowerCase()} network). Start with "${lead.label.toLowerCase()}"${
    actions.length > 1 ? `, then work through the remaining ${actions.length - 1} step${actions.length - 1 === 1 ? '' : 's'}.` : '.'
  }`
}

/* ==========================================================================
   The model
   ========================================================================== */

export type DigitalTwinInput = {
  /** Scheduled minutes for the whole corridor set. */
  baselineTravelMinutes: number
  scenario: TwinScenario
  /** Real itinerary legs, when a trip is in scope. */
  corridors?: TwinCorridorInput[]
}

/**
 * Runs one what-if and returns a fully self-consistent twin.
 *
 * Pure and synchronous: the UI can call it on every keystroke and the tests can
 * call it with no setup at all.
 */
export function calculateDigitalTwinSimulation(input: DigitalTwinInput): DigitalTwinSimulation {
  const scenario: TwinScenario = {
    weatherIntensity: WEATHER_INTENSITY_OPTIONS.some((option) => option.value === input.scenario?.weatherIntensity)
      ? input.scenario.weatherIntensity
      : DEFAULT_SCENARIO.weatherIntensity,
    durationHours: clamp(
      Math.round(Number(input.scenario?.durationHours ?? DEFAULT_SCENARIO.durationHours)),
      DURATION_RANGE.min,
      DURATION_RANGE.max,
    ),
    temperatureC: clamp(
      Math.round(Number(input.scenario?.temperatureC ?? DEFAULT_SCENARIO.temperatureC)),
      TEMPERATURE_RANGE.min,
      TEMPERATURE_RANGE.max,
    ),
    location: input.scenario?.location?.trim() || DEFAULT_LOCATION,
  }

  const { weatherIntensity, durationHours, temperatureC, location } = scenario
  const baselineTravelMinutes = Math.max(1, Math.round(Number(input.baselineTravelMinutes) || 0) || 1)

  /* --- 1. How much slower, and why ---------------------------------- */

  const rawRatio =
    INTENSITY_DELAY_FACTOR[weatherIntensity] +
    // Exposure only costs something if something is falling. Three hours of
    // clear, mild weather is three hours of clear, mild weather.
    (weatherIntensity === 'none' ? 0 : durationDelayFactor(durationHours)) +
    iceDelayFactor(weatherIntensity, temperatureC) +
    heatDelayFactor(temperatureC)
  const delayRatio = clamp(rawRatio, 0, MAX_DELAY_RATIO)
  const delayMinutes = Math.round(baselineTravelMinutes * delayRatio)
  const simulatedTravelMinutes = baselineTravelMinutes + delayMinutes
  const delayPercent = baselineTravelMinutes > 0 ? Math.round((delayMinutes / baselineTravelMinutes) * 100) : 0

  const hazards = deriveHazards(weatherIntensity, temperatureC)

  /* --- 2. Spread it across the real corridors ------------------------ */

  const corridorInputs = normaliseCorridors(input.corridors)
  const corridors = buildCorridors(corridorInputs, delayMinutes, baselineTravelMinutes, hazards)
  const worstCorridor = [...corridors].sort((a, b) => b.delayMinutes - a.delayMinutes || a.label.localeCompare(b.label))[0] ?? null

  const atRiskConnections = corridors.filter((corridor) => corridor.connectionStatus === 'at-risk' || corridor.connectionStatus === 'broken').length
  const brokenConnections = corridors.filter((corridor) => corridor.connectionStatus === 'broken').length

  /* --- 3. Score the outcome ----------------------------------------- */

  // Score the delay that was actually applied, not the pre-rounding ratio.
  // Otherwise a one-minute trip could display "0 min delay" next to a "medium"
  // risk score, which is exactly the kind of contradiction this model exists
  // to avoid.
  const effectiveDelayRatio = delayMinutes / baselineTravelMinutes

  const rawRiskScore = clamp(
    effectiveDelayRatio * 100 +
      iceRiskPoints(weatherIntensity, temperatureC) +
      floodRiskPoints(weatherIntensity) +
      (hazards.includes('heat') ? Math.min(8, (temperatureC - HEAT_START_C) * 0.8) : 0) +
      Math.min(MAX_CONNECTIONS_RISK_POINTS, atRiskConnections * 8 + brokenConnections * 12),
    0,
    100,
  )
  // Round once, then derive everything else from the rounded figure, so the
  // risk and resilience the page shows actually reconcile.
  const riskScore = round(rawRiskScore, 1)

  const riskLevel = riskLevelFor(riskScore)
  const routeStatus = routeStatusFor(riskLevel)
  const resilienceScore = Math.round(clamp(100 - riskScore, 0, 100))

  /* --- 4. What to do about it --------------------------------------- */

  const disruptions = buildDisruptions(corridors, hazards)
  const recommendedBufferMinutes =
    delayMinutes === 0
      ? 0
      : Math.min(MAX_BUFFER_MINUTES, Math.max(5, Math.round(delayMinutes * 0.4) + atRiskConnections * 10))

  const alternativeRoute = buildAlternativeRoute(
    weatherIntensity,
    hazards,
    worstCorridor,
    recommendedBufferMinutes,
  )

  const actions = buildActions({
    riskLevel,
    hazards,
    worst: worstCorridor,
    delayMinutes,
    bufferMinutes: recommendedBufferMinutes,
    atRiskConnections,
    brokenConnections,
    alternativeRoute,
    simulatedMinutes: simulatedTravelMinutes,
    baselineMinutes: baselineTravelMinutes,
  })

  const impactSummary = buildImpactSummary({
    intensity: weatherIntensity,
    delayMinutes,
    delayPercent,
    baselineMinutes: baselineTravelMinutes,
    corridors,
    atRiskConnections,
    brokenConnections,
    routeStatus,
  })

  const durationText = formatDurationHours(durationHours)
  const weatherChange = `${weatherIntensityTitle(weatherIntensity)} for ${durationText} at ${temperatureC}°C in ${location}`

  return {
    scenario,
    weatherChange,
    weatherIntensity,
    baselineTravelMinutes,
    simulatedTravelMinutes,
    delayMinutes,
    delayPercent,
    routeStatus,
    riskLevel,
    riskScore,
    resilienceScore,
    hazards,
    corridors,
    worstCorridor,
    disruptions,
    disruptionCount: disruptions.length,
    atRiskConnections,
    brokenConnections,
    recommendedBufferMinutes,
    alternativeRoute,
    recoveryPlan: buildRecoveryPlan(actions, riskLevel, routeStatus),
    actions,
    impactSummary,
  }
}

/* ==========================================================================
   Scenario summary (clipboard) and observed (today's) state
   ========================================================================== */

/**
 * Plain-text version of a scenario, for the clipboard. Built from the
 * simulation itself rather than re-typed in the UI, so a copied scenario can
 * never differ from the one on screen.
 */
export function buildScenarioSummary(simulation: DigitalTwinSimulation, scopeLabel: string): string {
  const lines = [
    `Wayvo digital twin — ${simulation.weatherChange}`,
    `Scope: ${scopeLabel}`,
    `Baseline: ${formatMinutes(simulation.baselineTravelMinutes)} (${simulation.corridors.length} corridor${simulation.corridors.length === 1 ? '' : 's'})`,
    `Simulated: ${formatMinutes(simulation.simulatedTravelMinutes)} (+${simulation.delayMinutes} min, +${simulation.delayPercent}%)`,
    `Network: ${routeStatusLabel(simulation.routeStatus)} · risk ${riskLevelLabel(simulation.riskLevel)} (${simulation.riskScore}) · resilience ${simulation.resilienceScore}/100`,
    `Hazards: ${simulation.hazards.length > 0 ? simulation.hazards.map((hazard) => HAZARD_LABELS[hazard]).join(', ') : 'none'}`,
  ]

  if (simulation.corridors.length > 0) {
    lines.push('', 'Corridors:')
    for (const corridor of simulation.corridors) {
      const connection =
        corridor.connectionStatus === 'none' || corridor.connectionStatus === 'ok'
          ? ''
          : ` · ${connectionStatusLabel(corridor.connectionStatus)} (${corridor.connectionMinutes} min window)`
      lines.push(
        `- ${corridor.label}: ${routeStatusLabel(corridor.status)}, +${corridor.delayMinutes} min (${formatMinutes(corridor.baseMinutes)} scheduled)${connection}`,
      )
    }
  }

  if (simulation.disruptions.length > 0) {
    lines.push('', 'Disruptions:')
    for (const disruption of simulation.disruptions) {
      lines.push(`- [${disruption.severity}] ${disruption.label} (+${disruption.delayMinutes} min)`)
    }
  }

  lines.push('', `Route adaptation: ${simulation.alternativeRoute}`)
  if (simulation.recommendedBufferMinutes > 0) {
    lines.push(`Recommended buffer: ${simulation.recommendedBufferMinutes} min`)
  }
  lines.push('', 'Response:')
  simulation.actions.forEach((action, index) => {
    lines.push(`${index + 1}. [${action.urgency}] ${action.label} — ${action.detail}`)
  })

  return lines.join('\n')
}

/** How much one open alert of each severity is worth on the observed scale. */
const OBSERVED_SEVERITY_WEIGHT: Record<string, number> = { critical: 70, warn: 35 }
const OBSERVED_DEFAULT_WEIGHT = 10
/** Each additional open alert adds a little, up to a cap. */
const OBSERVED_EXTRA_ALERT_POINTS = 3
const MAX_OBSERVED_EXTRA_POINTS = 15

/**
 * The "before" column is the real network, not a hard-coded zero. The open
 * disruptions the traveller genuinely has are turned into the same status and
 * risk vocabulary the simulation uses, so the comparison is like for like.
 *
 * Severity follows the *worst* open alert rather than an average: one
 * cancelled booking is a critical situation no matter how many informational
 * notices are sitting beside it.
 *
 * A missing table is a legitimate state, not an error, so `rows` may be empty.
 */
export function describeCurrentState(
  rows: ReadonlyArray<{ severity?: string | null }> | null | undefined,
): { disruptionCount: number; routeStatus: RouteStatus; riskLevel: RiskLevel } {
  const list = rows ?? []
  if (list.length === 0) return { disruptionCount: 0, routeStatus: 'normal', riskLevel: 'low' }

  const worst = list.reduce(
    (heaviest, row) => Math.max(heaviest, OBSERVED_SEVERITY_WEIGHT[row?.severity ?? ''] ?? OBSERVED_DEFAULT_WEIGHT),
    0,
  )
  const score = clamp(worst + Math.min(MAX_OBSERVED_EXTRA_POINTS, (list.length - 1) * OBSERVED_EXTRA_ALERT_POINTS), 0, 100)
  const riskLevel = riskLevelFor(score)
  return { disruptionCount: list.length, routeStatus: routeStatusFor(riskLevel), riskLevel }
}
