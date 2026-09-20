/**
 * Layer candidates and analysis defaults.
 *
 * Each entry lists identifiers in preference order. The app probes them at
 * startup and uses the first that responds, so a retired or renamed product
 * degrades to the next best source instead of breaking the page.
 */

export const LAYERS = {
  lstDay: {
    label: 'Surface temperature (day)',
    candidates: ['MODIS_Terra_Land_Surface_Temp_Day', 'MODIS_Aqua_Land_Surface_Temp_Day'],
    ext: 'png',
    dates: 6,
    periodDays: 1,
    required: true,
  },
  lstNight: {
    label: 'Surface temperature (night)',
    candidates: ['MODIS_Terra_Land_Surface_Temp_Night', 'MODIS_Aqua_Land_Surface_Temp_Night'],
    ext: 'png',
    dates: 4,
    periodDays: 1,
    required: false,
  },
  ndvi: {
    label: 'Vegetation index (NDVI)',
    candidates: ['MODIS_Terra_NDVI_8Day', 'MODIS_Aqua_NDVI_8Day'],
    ext: 'png',
    dates: 3,
    periodDays: 8,
    required: true,
  },
  population: {
    label: 'Population density',
    candidates: [
      'GPW_Population_Density_2020',
      'GPW_Population_Density_2015',
      'GPW_Population_Density_2010',
    ],
    ext: 'png',
    dates: 1,
    periodDays: 1,
    static: true,
    required: false,
  },
};

export const BASEMAPS = {
  trueColor: {
    label: 'NASA true colour',
    candidates: [
      'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
      'VIIRS_SNPP_CorrectedReflectance_TrueColor',
      'MODIS_Terra_CorrectedReflectance_TrueColor',
    ],
    ext: 'jpg',
  },
};

export const ANALYSIS = {
  /** Default half-width of the study area, in kilometres. */
  defaultSpanKm: 36,
  minSpanKm: 8,
  maxSpanKm: 120,
  /** Upper bound on grid cells, to keep sampling responsive on phones. */
  maxCells: 1000,
  /** Minimum valid cells before a calibration is considered trustworthy. */
  minCellsForCalibration: 30,
  /** Vegetation target: the local percentile a cell is held to. */
  targetPercentile: 0.75,
  maxTilesPerRequest: 36,
  /** Night minimum above which sleep is materially disrupted (deg C). */
  hotNightThresholdC: 20,
  powerStartYear: 1985,
};

export const SOURCES = [
  { name: 'NASA GIBS', detail: 'MODIS land surface temperature and NDVI imagery', url: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { name: 'NASA SEDAC', detail: 'Gridded Population of the World, v4', url: 'https://sedac.ciesin.columbia.edu/data/collection/gpw-v4' },
  { name: 'NASA POWER', detail: 'Four-decade climate record by coordinate', url: 'https://power.larc.nasa.gov/' },
  { name: 'Open-Meteo', detail: 'Place name search', url: 'https://open-meteo.com/' },
];
