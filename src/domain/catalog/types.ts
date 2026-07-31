export type ProductCategory = "camera" | "recorder" | "switch" | "storage" | "ups";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type CameraSpecs = {
  technology: "IP" | "TVI" | "CVI" | "AHD";
  cameraType: "bullet" | "dome" | "turret" | "ptz";
  resolutionMp: number;
  resolutionWidth: number;
  resolutionHeight: number;
  sensorFormat: string;
  focalMinMm: number;
  focalMaxMm: number;
  horizontalFovMin: number;
  horizontalFovMax: number;
  maxFps: number;
  codecs: string[];
  recommendedBitrateKbps: number;
  irRangeM: number;
  doriDetectM: number;
  doriObserveM: number;
  doriRecognizeM: number;
  doriIdentifyM: number;
  microphone: boolean;
  speaker: boolean;
  poe: boolean;
  maxPowerW: number;
  ipRating: string;
  aiFeatures: string[];
  localStorageGb?: number;
};

export type RecorderSpecs = {
  technology: "NVR" | "DVR";
  channels: number;
  incomingBandwidthMbps: number;
  maxDecodeMp: number;
  driveBays: number;
  maxDriveCapacityTb: number;
  raidLevels: string[];
  builtInPoePorts: number;
  codecs: string[];
  maxCameraResolutionMp: number;
  outgoingBandwidthMbps?: number;
  decodeCapacityMp?: number;
  maxSimultaneousDecodeChannels?: number;
  basePowerW?: number;
  drivePowerPerBayW?: number;
};

export type SwitchSpecs = {
  poePorts: number;
  totalPorts: number;
  poeBudgetW: number;
  maxPowerPerPortW: number;
  uplinkGbps: number;
  extendRangeM: number;
  managed: boolean;
  surgeProtection: boolean;
  systemPowerW?: number;
  poeEfficiency?: number;
};

export type StorageSpecs = {
  capacityTb: number;
  workloadTbPerYear: number;
  surveillanceOptimized: boolean;
  warrantyMonths: number;
  activePowerW?: number;
};

export type UpsSpecs = {
  capacityVa: number;
  outputPowerW: number;
  backupMinutesAtHalfLoad: number;
};

export type CatalogProduct = {
  id: string;
  wooId: number;
  sku: string;
  name: string;
  brand: string;
  category: ProductCategory;
  price: number;
  stockStatus: StockStatus;
  stockQuantity: number;
  warrantyMonths: number;
  sourceUrl: string;
  source: "mock-ddcpersia" | "woocommerce";
  images?: {
    url: string;
    alt: string;
    source: "ddcpersia" | "ai-generated";
  }[];
  specs: CameraSpecs | RecorderSpecs | SwitchSpecs | StorageSpecs | UpsSpecs;
  dataQuality?: { status: "verified" | "estimated" | "incomplete"; warnings: string[] };
};

export type SourceCatalogProduct = {
  id: string;
  wooId: number;
  sku: string;
  name: string;
  brand: string;
  category: ProductCategory | "other";
  wooCategories: string[];
  price: number;
  stockStatus: StockStatus;
  stockQuantity: number;
  sourceUrl: string;
  source: "mock-ddcpersia" | "woocommerce";
  sourceModifiedAt?: string;
  images: { url: string; originalUrl: string; alt: string; cached: boolean }[];
  attributes: { name: string; slug?: string; options: string[] }[];
  specs?: CameraSpecs | RecorderSpecs | SwitchSpecs | StorageSpecs | UpsSpecs;
  normalizationStatus: "verified" | "estimated" | "unmapped";
  normalizationWarnings: string[];
  datasheet?: {
    brand: string;
    partNumber: string;
    sourceUrl: string;
    sourceTitle: string;
    facts: Record<string, string | number | boolean | string[]>;
    verifiedAt: string;
  };
};

export type SourceCatalogPage = {
  products: SourceCatalogProduct[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  facets: { brands: string[]; categoryCounts: Record<string, number> };
  imageCache: { queued: number; downloading: number; completed: number; failed: number };
};

export type SurveillanceTask = "monitor" | "face-capture" | "face-identify" | "plate-capture" | "anpr";

export type CameraHousing = "dome" | "turret" | "bullet" | "ptz";

export type ProjectCameraConfig = {
  /** User-facing identity shared by the cameras in this group. */
  label: string;
  housing: CameraHousing;
  megapixel: number;
  sensorWidthMm: number;
  focalMm: number;
  irRangeM: number;
  maxRangeM: number;
  microphone: boolean;
  colorNightVision: boolean;
  weatherproof: boolean;
};

export type ProjectCameraUnit = ProjectCameraConfig & {
  id: string;
  targetDistanceM: number;
  sceneWidthM: number;
  mountingHeightM: number;
  targetHeightM: number;
  cameraTiltDeg: number;
  minimumPpm: number;
  measuredBitrateKbps?: number;
};

export type ProjectZone = {
  id: string;
  name: string;
  cameraCount: number;
  outdoor: boolean;
  goal: SurveillanceTask;
  targetDistanceM: number;
  sceneWidthM: number;
  mountingHeightM: number;
  targetHeightM: number;
  cameraTiltDeg: number;
  minimumPpm?: number;
  measuredBitrateKbps?: number;
  /** Independently configured cameras belonging to this group. */
  cameras?: ProjectCameraUnit[];
  /** Legacy shared configuration retained for saved-project migration. */
  cameraConfig?: ProjectCameraConfig;
};

export type EngineeringPoint = { xM: number; yM: number };
export type EngineeringCameraPlacement = {
  id: string;
  zoneId: string;
  zoneName: string;
  productId: string;
  productName: string;
  xM: number;
  yM: number;
  mountingHeightM: number;
  yawDeg: number;
  tiltDeg: number;
  horizontalFovDeg: number;
  verticalFovDeg: number;
  nearGroundM: number;
  farGroundM: number;
  coveragePolygon: EngineeringPoint[];
  targetPlane: { center: EngineeringPoint; left: EngineeringPoint; right: EngineeringPoint; ppm: number };
};

export type EngineeringHeatmapCell = {
  xM: number;
  yM: number;
  ppm: number;
  cameraCount: number;
  blind: boolean;
};

export type EngineeringMap = {
  widthM: number;
  heightM: number;
  gridColumns: number;
  gridRows: number;
  placements: EngineeringCameraPlacement[];
  heatmap: EngineeringHeatmapCell[];
  blindSpotPercent: number;
};

export type InfrastructureEstimate = {
  copperCableM: number;
  fiberBackboneM: number;
  rackCount: number;
  recommendedRackU: number;
  patchPanelCount: number;
  sfpModuleCount: number;
  floorDistributors: number;
  upsLoadW: number;
  upsRequiredW: number;
};

export type ProjectBrief = {
  projectType: "shop" | "office" | "factory" | "parking" | "residential";
  cameraCount: number;
  outdoorCount: number;
  entrances: number;
  goal: SurveillanceTask | "mixed";
  archiveDays: number;
  budget: "economy" | "balanced" | "professional";
  preferredBrand?: string;
  siteAreaM2?: number;
  floors?: number;
  maxCableRunM?: number;
  remoteViewingUsers?: number;
  lowLightPriority?: boolean;
  audioRequired?: boolean;
  localRecordingFallback?: boolean;
  redundancyRequired?: boolean;
  upsRuntimeMinutes?: number;
  budgetMinIrt?: number;
  budgetMaxIrt?: number;
  recordingMode: "continuous" | "motion";
  motionActivityPercent: number;
  bitrateMode: "CBR" | "VBR";
  recordAudio: boolean;
  audioBitrateKbps: number;
  filesystemOverheadPercent: number;
  vbrSafetyMarginPercent: number;
  reservePercent: number;
  zones?: ProjectZone[];
};

export type RecommendationItem = {
  product: CatalogProduct;
  quantity: number;
  reasons: string[];
};

export type ProductEvaluation = {
  productId: string;
  productName: string;
  category: ProductCategory;
  status: "selected" | "accepted" | "rejected";
  reasons: string[];
  failedConstraints: string[];
};

export type RecommendationPlan = {
  id: "economy" | "balanced" | "professional";
  title: string;
  subtitle: string;
  score: number;
  totalPrice: number;
  items: RecommendationItem[];
  highlights: string[];
  metrics: {
    bandwidthMbps: number;
    storageRequiredTb: number;
    storageRawTb: number;
    storageUsableTb: number;
    raidLevel: string;
    hotSpareDrives: number;
    poeLoadW: number;
    poeBudgetW: number;
    upsLoadW: number;
    upsRequiredW: number;
    estimatedRuntimeMin?: number;
    requiredRuntimeMin?: number;
    expansionPorts: number;
    recommendedResolutionMp: number;
    minimumPpm: number;
    averagePpm: number;
    outgoingBandwidthMbps: number;
    decodeDemandMp: number;
    switchLocations: number;
    storageBaseTb: number;
    recordingDutyCycle: number;
    budgetMinIrt?: number;
    budgetMaxIrt?: number;
    budgetDeltaIrt?: number;
  };
  scoreBreakdown: {
    technicalFit: number;
    capacityHeadroom: number;
    imageQuality: number;
    reliability: number;
    stockAvailability: number;
    priceFit: number;
    preferredBrand: number;
  };
  constraints: {
    checked: string[];
    pending: string[];
  };
  evaluations: ProductEvaluation[];
  engineeringMap: EngineeringMap;
  infrastructure: InfrastructureEstimate;
};

export type RecommendationResult = {
  project: ProjectBrief;
  plans: RecommendationPlan[];
  rejected: { productName: string; reason: string }[];
  generatedAt: string;
  dataMode: "woocommerce-live" | "database-mock" | "mock-fallback";
  calculation: {
    engineVersion: string;
    inputVersion: string;
    standardVersions: string[];
    inputFingerprint: string;
  };
};
