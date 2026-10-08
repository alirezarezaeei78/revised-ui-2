"use client";

import { FormEvent, useEffect, useState } from "react";
import { Activity, CalendarDays, CheckCircle2, CloudDownload, Database, Download, Eye, EyeOff, MessageSquare, Pencil, Plus, RefreshCw, Save, Settings2, ShieldCheck, Trash2, UsersRound, X, ChevronDown, ChevronUp } from "lucide-react";
import type { UserPlan, UserRole } from "@/src/lib/authStore";
import { getSubscriptionAccess } from "@/src/lib/subscription";
import { RequiredNumberInput } from "@/src/components/calculators/CalculatorUi";

export type AdminUser = {
  id: string;
  username: string;
  role: UserRole;
  plan: UserPlan;
  isFreeAccount: boolean;
  displayName: string;
  signupAt: string;
  createdAt: string;
  lastLoginAt?: string;
  lockedUntil?: number;
  failedLogins: number;
  loginCount: number;
  trialDays: number;
  passwordPreview?: string;
  isProtected: boolean;
};

type SmsConfig = {
  providerName: string;
  apiUrl: string;
  senderNumber: string;
  templateId: string;
  timeoutSeconds: number;
  enabled: boolean;
  updatedAt?: string;
  apiKeySet: boolean;
};

type ActivityStats = {
  onlineNow: number;
  loginsToday: number;
  loginsThisWeek: number;
  loginsThisMonth: number;
};

type DailyLoginStats = {
  day: string;
  logins: number;
};

type CatalogSyncResult = {
  dryRun: boolean;
  sourceReadOnly: boolean;
  received: number;
  storedSourceProducts: number;
  normalized: number;
  skipped: number;
  categoryCounts: Record<string, number>;
  warnings: { wooId: number; name: string; warning: string }[];
};

type CatalogSyncRun = {
  id: number;
  dryRun: boolean;
  status: "queued" | "running" | "success" | "failed";
  stage: string;
  progressPercent: number;
  progressCurrent: number;
  progressTotal: number;
  logs: { at: string; level: "info" | "success" | "warning" | "error"; message: string }[];
  result: CatalogSyncResult | null;
  error: string | null;
  imageCache: { queued: number; downloading: number; completed: number; failed: number };
};

const catalogSyncStages = [
  { key: "connecting", label: "اتصال امن" },
  { key: "fetching", label: "دریافت صفحات" },
  { key: "normalizing", label: "تحلیل ویژگی‌ها" },
  { key: "saving-snapshots", label: "ذخیره Snapshot" },
  { key: "saving-normalized", label: "استانداردسازی" },
  { key: "committing", label: "صف تصاویر" }
];

const catalogStageOrder: Record<string, number> = { queued: 0, connecting: 0, fetching: 1, normalizing: 2, preparing: 3, "saving-snapshots": 3, "saving-normalized": 4, committing: 5, completed: 6, failed: -1 };

function LoginActivityChart({ entries, rangeLabel }: { entries: DailyLoginStats[]; rangeLabel: string }) {
  const width = 440;
  const height = 230;
  const padding = { top: 22, right: 18, bottom: 38, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxLogins = Math.max(1, ...entries.map((entry) => entry.logins));
  const baseY = padding.top + plotHeight;
  const labelStep = Math.max(1, Math.ceil(entries.length / 5));
  const points = entries.map((entry, index) => ({
    ...entry,
    x: padding.left + (entries.length > 1 ? (index / (entries.length - 1)) * plotWidth : plotWidth / 2),
    y: padding.top + (1 - entry.logins / maxLogins) * plotHeight
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = points.length
    ? `M ${points[0].x} ${baseY} ${points.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${points[points.length - 1].x} ${baseY} Z`
    : "";
  const numberFormat = new Intl.NumberFormat("fa-IR");

  return (
    <aside className="admin-login-chart" aria-labelledby="login-chart-title">
      <div className="admin-login-chart-head">
        <div>
          <h3 id="login-chart-title">نمودار ورود کاربران</h3>
          <p>{rangeLabel}</p>
        </div>
        <strong>{numberFormat.format(entries.reduce((total, entry) => total + entry.logins, 0))}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`نمودار ورود کاربران در ${rangeLabel}`}>
        <defs>
          <linearGradient id="login-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1689c9" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#1689c9" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding.top + step * plotHeight;
          return <line key={step} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />;
        })}
        {areaPath ? <path d={areaPath} className="chart-area" /> : null}
        {linePath ? <path d={linePath} className="chart-line" /> : null}
        {points.map((point, index) => (
          <g key={point.day}>
            <circle cx={point.x} cy={point.y} r="4" className="chart-point">
              <title>{`${new Date(point.day).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}: ${numberFormat.format(point.logins)} ورود`}</title>
            </circle>
            {(index % labelStep === 0 || index === points.length - 1) ? (
              <text x={point.x} y={height - 14} textAnchor="middle" className="chart-axis-label">
                {new Date(point.day).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}
              </text>
            ) : null}
          </g>
        ))}
        <text x={padding.left - 7} y={padding.top + 5} textAnchor="end" className="chart-axis-label">{numberFormat.format(maxLogins)}</text>
        <text x={padding.left - 7} y={baseY + 4} textAnchor="end" className="chart-axis-label">۰</text>
      </svg>
    </aside>
  );
}

type AdminPanelProps = {
  currentUserId: string;
  initialUsers: AdminUser[];
  initialTotalUsers: number;
  initialTotalPages: number;
  initialDefaultTrialDays: number;
  initialSmsConfig: SmsConfig;
};

export function AdminPanel({ 
  currentUserId, 
  initialUsers, 
  initialTotalUsers,
  initialTotalPages,
  initialDefaultTrialDays,
  initialSmsConfig 
}: AdminPanelProps) {
  const [users, setUsers] = useState(initialUsers);
  const [totalUsers, setTotalUsers] = useState(initialTotalUsers);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [smsConfig, setSmsConfig] = useState(initialSmsConfig);
  const [defaultTrialDays, setDefaultTrialDays] = useState(initialDefaultTrialDays);
  const [savingDefaultTrial, setSavingDefaultTrial] = useState(false);
  const [applyTrialToExisting, setApplyTrialToExisting] = useState(true);
  const [bulkTarget, setBulkTarget] = useState("free");
  const [bulkOperation, setBulkOperation] = useState("trialDays");
  const [bulkTrialDays, setBulkTrialDays] = useState(initialDefaultTrialDays);
  const [savingBulk, setSavingBulk] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    displayName: "",
    role: "user" as UserRole,
    plan: "free" as UserPlan,
    trialDays: initialDefaultTrialDays,
    daysLeft: initialDefaultTrialDays,
    password: ""
  });
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: "",
    role: "user" as UserRole,
    plan: "free" as UserPlan,
    trialDays: initialDefaultTrialDays,
    daysLeft: initialDefaultTrialDays,
    password: ""
  });
  const [apiKey, setApiKey] = useState("");
  const [now] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingUserId, setPendingUserId] = useState("");
  const [savingSms, setSavingSms] = useState(false);
  const [exportingUsers, setExportingUsers] = useState(false);
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const [dailyLogins, setDailyLogins] = useState<DailyLoginStats[]>([]);
  const [activityRange, setActivityRange] = useState<"week" | "month">("week");
  const [catalogSyncing, setCatalogSyncing] = useState<"dry-run" | "sync" | null>(null);
  const [catalogSyncResult, setCatalogSyncResult] = useState<CatalogSyncResult | null>(null);
  const [catalogSyncRun, setCatalogSyncRun] = useState<CatalogSyncRun | null>(null);
  const activeCatalogRunId = catalogSyncRun?.id;
  const activeCatalogRunStatus = catalogSyncRun?.status;
  const activeCatalogImages = (catalogSyncRun?.imageCache?.queued || 0) + (catalogSyncRun?.imageCache?.downloading || 0);

  useEffect(() => {
    let disposed = false;
    const loadActivityStats = async () => {
      try {
        const response = await fetch(`/api/admin/activity?range=${activityRange}`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok && data.ok && !disposed) {
          setActivityStats(data.stats);
          setDailyLogins(data.dailyLogins ?? []);
        }
      } catch {
        // Management remains available if live metrics are temporarily unavailable.
      }
    };

    void loadActivityStats();
    const intervalId = window.setInterval(loadActivityStats, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [activityRange]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/admin/catalog/sync", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (disposed || !data.run) return;
      setCatalogSyncRun(data.run);
      if (data.run.status === "queued" || data.run.status === "running") setCatalogSyncing(data.run.dryRun ? "dry-run" : "sync");
      if (data.run.result) setCatalogSyncResult(data.run.result);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!activeCatalogRunId || ((activeCatalogRunStatus !== "queued" && activeCatalogRunStatus !== "running") && activeCatalogImages === 0)) return;
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/catalog/sync?runId=${activeCatalogRunId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.run || disposed) return;
        const run = data.run as CatalogSyncRun;
        setCatalogSyncRun(run);
        if (run.status === "success") {
          setCatalogSyncing(null);
          if (run.result) setCatalogSyncResult(run.result);
          setMessage(run.dryRun ? "بررسی آزمایشی کامل شد؛ هیچ داده‌ای تغییر نکرد." : "محصولات در دیتابیس اپ ذخیره شدند و صف تصاویر فعال شد.");
        } else if (run.status === "failed") {
          setCatalogSyncing(null);
          setError(run.error || "دریافت محصولات متوقف شد؛ جزئیات در لاگ آمده است.");
        }
      } catch { /* The next poll retries transient network errors. */ }
    };
    void poll();
    const interval = window.setInterval(poll, 1_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [activeCatalogRunId, activeCatalogRunStatus, activeCatalogImages]);

  const fetchPage = async (
    page: number,
    search = searchQuery,
    plan = planFilter,
    role = roleFilter,
    sort = sortBy
  ) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: "50",
        search,
        plan,
        role,
        sortBy: sort
      });
      const response = await fetch(`/api/admin/accounts?${queryParams.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error || "خطا در بارگذاری کاربران.");
        return;
      }
      setUsers(data.users);
      setTotalUsers(data.totalUsers);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
      if (typeof data.defaultTrialDays === "number") setDefaultTrialDays(data.defaultTrialDays);
    } catch {
      setError("خطا در ارتباط با سرور.");
    } finally {
      setLoading(false);
    }
  };

  const getDaysLeft = (user: Pick<AdminUser, "plan" | "isFreeAccount" | "signupAt" | "createdAt" | "trialDays">) => {
    return getSubscriptionAccess(user, now).trialDaysRemaining;
  };

  async function saveDefaultTrial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDefaultTrial(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "settings", defaultTrialDays, applyToExistingFree: applyTrialToExisting })
    });
    const data = await response.json();
    setSavingDefaultTrial(false);

    if (!response.ok || !data.ok) {
      setError(data.error || "ذخیره مدت تست انجام نشد.");
      return;
    }

    setDefaultTrialDays(data.defaultTrialDays);
    setBulkTrialDays(data.defaultTrialDays);
    setCreateForm((current) => ({ ...current, trialDays: data.defaultTrialDays, daysLeft: data.defaultTrialDays }));
    setMessage(applyTrialToExisting
      ? `مدت تست ذخیره شد و برای ${data.affectedUsers ?? 0} کاربر رایگان به‌روزرسانی شد.`
      : "مدت پیش‌فرض تست برای کاربران جدید ذخیره شد.");
  }

  async function applyBulkOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetLabel = bulkTarget === "all" ? "همه کاربران" : bulkTarget === "pro" ? "کاربران حرفه‌ای" : "کاربران رایگان";
    const operationLabel = bulkOperation === "trialDays"
      ? `تغییر مدت تست به ${bulkTrialDays} روز`
      : bulkOperation === "planFree"
        ? "تبدیل اشتراک به رایگان"
        : bulkOperation === "planPro"
          ? "تبدیل اشتراک به حرفه‌ای"
          : "باز کردن قفل ورود";

    if (!window.confirm(`${operationLabel} برای ${targetLabel} انجام شود؟`)) return;

    setSavingBulk(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "bulk",
          target: bulkTarget,
          operation: bulkOperation,
          trialDays: bulkTrialDays
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error || "عملیات گروهی انجام نشد.");
        return;
      }

      await fetchPage(currentPage);
      setMessage(`عملیات برای ${data.affectedUsers ?? 0} کاربر انجام شد.`);
    } catch {
      setError("خطا در ارتباط با سرور برای عملیات گروهی.");
    } finally {
      setSavingBulk(false);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const password = createForm.password.trim() || createForm.username.trim();
    const response = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createForm, password })
    });
    const data = await response.json();
    setLoading(false);

    if (!response.ok || !data.ok) {
      setError(data.error || "ایجاد کاربر انجام نشد.");
      return;
    }

    setCreateForm({
      username: "",
      displayName: "",
      role: "user",
      plan: "free",
      trialDays: defaultTrialDays,
      daysLeft: defaultTrialDays,
      password: ""
    });
    setMessage("کاربر جدید ایجاد شد.");
    setCreateModalOpen(false);
    fetchPage(1);
  }

  function startEdit(user: AdminUser) {
    setEditingUser(user);
    setEditForm({
      displayName: user.displayName,
      role: user.role,
      plan: user.plan,
      trialDays: user.trialDays ?? defaultTrialDays,
      daysLeft: getDaysLeft(user),
      password: ""
    });
  }

  async function saveEditedAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setPendingUserId(editingUser.id);
    setError("");
    setMessage("");

    const response = await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: editingUser.id, ...editForm })
    });
    const data = await response.json();
    setPendingUserId("");

    if (!response.ok || !data.ok) {
      setError(data.error || "ویرایش کاربر انجام نشد.");
      return;
    }

    setEditingUser(null);
    setMessage("اطلاعات کاربر ذخیره شد.");
    fetchPage(currentPage);
  }

  function closeCreateModal() {
    setCreateModalOpen(false);
    setCreateForm({
      username: "",
      displayName: "",
      role: "user",
      plan: "free",
      trialDays: defaultTrialDays,
      daysLeft: defaultTrialDays,
      password: ""
    });
  }

  function closeEditModal() {
    setEditingUser(null);
    setEditForm({
      displayName: "",
      role: "user",
      plan: "free",
      trialDays: defaultTrialDays,
      daysLeft: defaultTrialDays,
      password: ""
    });
  }

  const handleFilterChange = (updates: { plan?: string; role?: string; sortBy?: string }) => {
    const nextPlan = updates.plan !== undefined ? updates.plan : planFilter;
    const nextRole = updates.role !== undefined ? updates.role : roleFilter;
    const nextSort = updates.sortBy !== undefined ? updates.sortBy : sortBy;
    fetchPage(1, searchQuery, nextPlan, nextRole, nextSort);
  };

  async function deleteAccount(id: string) {
    setPendingUserId(id);
    setError("");
    setMessage("");

    const response = await fetch("/api/admin/accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = await response.json();
    setPendingUserId("");

    if (!response.ok || !data.ok) {
      setError(data.error || "حذف حساب انجام نشد.");
      return;
    }

    setMessage("حساب کاربری حذف شد.");
    fetchPage(currentPage);
  }

  async function saveSmsConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSms(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/admin/sms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...smsConfig, apiKey })
    });
    const data = await response.json();
    setSavingSms(false);

    if (!response.ok || !data.ok) {
      setError(data.error || "ذخیره تنظیمات پیامک انجام نشد.");
      return;
    }

    setSmsConfig(data.config);
    setApiKey("");
    setMessage("تنظیمات پیامک ذخیره شد.");
  }

  async function exportUsers() {
    setExportingUsers(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/accounts/export");
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || "خطا در دریافت فایل اکسل کاربران.");
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "users.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage("فایل اکسل همه کاربران دانلود شد.");
    } catch {
      setError("خطا در ارتباط با سرور برای دریافت فایل اکسل.");
    } finally {
      setExportingUsers(false);
    }
  }

  async function syncCatalog(dryRun: boolean) {
    setCatalogSyncing(dryRun ? "dry-run" : "sync");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/catalog/sync?dryRun=${dryRun}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "همگام‌سازی کاتالوگ WooCommerce انجام نشد.");
        return;
      }
      setCatalogSyncRun({ id: data.runId, dryRun, status: "queued", stage: "queued", progressPercent: 0, progressCurrent: 0, progressTotal: 0, logs: [], result: null, error: null, imageCache: { queued: 0, downloading: 0, completed: 0, failed: 0 } });
      setMessage(data.alreadyRunning ? "یک عملیات قبلی در حال اجراست؛ نمایش وضعیت آن ادامه پیدا می‌کند." : "عملیات در پس‌زمینه آغاز شد؛ می‌توانید مراحل را زنده دنبال کنید.");
    } catch {
      setError("ارتباط با WooCommerce یا سرور برنامه برقرار نشد.");
      setCatalogSyncing(null);
    }
  }

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        pages.push(1, 2, 3, 4, 5, "...", totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages);
      }
    }
    return pages;
  };

  return (
    <div className="admin-page">
      <section className="calc-header admin-header-compact">
        <div>
          <p className="eyebrow">مدیریت</p>
          <h1 style={{ marginBottom: 0 }}>پنل مدیریت کاربران و پیامک</h1>
        </div>
      </section>

      <section className="admin-grid">
        <article className="panel admin-card admin-users-card">
          <div className="admin-section-title">
            <span className="category-icon">
              <UsersRound size={20} aria-hidden="true" />
            </span>
            <div style={{ flex: 1 }}>
              <h2>حساب‌های ساخته‌شده</h2>
              <p>{totalUsers} حساب در سیستم</p>
            </div>
            
            <form 
              onSubmit={(e) => { e.preventDefault(); fetchPage(1); }}
              className="admin-search-form"
            >
              <input 
                type="text" 
                placeholder="جستجوی نام یا موبایل..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit">جستجو</button>
            </form>
          </div>

          <div className="admin-filter-bar">
            <label>
              <span>اشتراک:</span>
              <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); handleFilterChange({ plan: e.target.value }); }}>
                <option value="all">همه اشتراک‌ها</option>
                <option value="pro">حرفه‌ای (Pro)</option>
                <option value="free">رایگان (Free)</option>
              </select>
            </label>

            <label>
              <span>نقش:</span>
              <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); handleFilterChange({ role: e.target.value }); }}>
                <option value="all">همه نقش‌ها</option>
                <option value="admin">مدیر (Admin)</option>
                <option value="user">کاربر (User)</option>
              </select>
            </label>

            <label>
              <span>مرتب‌سازی:</span>
              <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); handleFilterChange({ sortBy: e.target.value }); }}>
                <option value="newest">جدیدترین به قدیمی‌ترین</option>
                <option value="oldest">قدیمی‌ترین به جدیدترین</option>
                <option value="mostLogins">بیشترین تعداد ورود</option>
                <option value="leastLogins">کمترین تعداد ورود</option>
              </select>
            </label>
          </div>

          <section className="admin-activity-grid" aria-label="آمار فعالیت کاربران">
            <article className="admin-activity-card online">
              <span className="admin-activity-icon"><Activity size={18} aria-hidden="true" /></span>
              <div>
                <small>آنلاین اکنون</small>
                <strong>{new Intl.NumberFormat("fa-IR").format(activityStats?.onlineNow ?? 0)}</strong>
                <span className="admin-online-status"><i aria-hidden="true" />فعال در ۵ دقیقه اخیر</span>
              </div>
            </article>
            <article className="admin-activity-card">
              <span className="admin-activity-icon"><CalendarDays size={18} aria-hidden="true" /></span>
              <div><small>ورود امروز</small><strong>{new Intl.NumberFormat("fa-IR").format(activityStats?.loginsToday ?? 0)}</strong></div>
            </article>
            <article className="admin-activity-card">
              <span className="admin-activity-icon"><UsersRound size={18} aria-hidden="true" /></span>
              <div><small>ورود این هفته</small><strong>{new Intl.NumberFormat("fa-IR").format(activityStats?.loginsThisWeek ?? 0)}</strong></div>
            </article>
            <article className="admin-activity-card">
              <span className="admin-activity-icon"><Activity size={18} aria-hidden="true" /></span>
              <div><small>ورود این ماه</small><strong>{new Intl.NumberFormat("fa-IR").format(activityStats?.loginsThisMonth ?? 0)}</strong></div>
            </article>
          </section>

          <section className="admin-activity-details" aria-label="جزئیات ورود کاربران">
            <LoginActivityChart entries={dailyLogins} rangeLabel={activityRange === "week" ? "هفت روز اخیر" : "ماه جاری"} />
            <section className="admin-daily-logins" aria-labelledby="daily-logins-title">
              <div className="admin-daily-logins-head">
                <div>
                  <h3 id="daily-logins-title">جدول ورود روزانه</h3>
                  <p>{activityRange === "week" ? "شامل ورودهای ثبت‌شده در هفت روز اخیر" : "شامل ورودهای ثبت‌شده از ابتدای ماه جاری"}</p>
                </div>
                <div className="admin-activity-range" role="group" aria-label="بازه نمایش ورودها">
                  <button type="button" className={activityRange === "week" ? "active" : ""} onClick={() => setActivityRange("week")}>۷ روز</button>
                  <button type="button" className={activityRange === "month" ? "active" : ""} onClick={() => setActivityRange("month")}>ماه جاری</button>
                </div>
              </div>
              <div className="admin-daily-logins-table-wrap">
                <table>
                  <thead><tr><th>روز</th><th>تعداد ورود موفق</th></tr></thead>
                  <tbody>
                    {dailyLogins.map((entry) => (
                      <tr key={entry.day}>
                        <td>{new Date(entry.day).toLocaleDateString("fa-IR", { month: "long", day: "numeric" })}</td>
                        <td>{new Intl.NumberFormat("fa-IR").format(entry.logins)}</td>
                      </tr>
                    ))}
                    {dailyLogins.length === 0 ? <tr><td colSpan={2}>در حال دریافت آمار...</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <div className="admin-management-grid">
            <form className="admin-setting-card" onSubmit={saveDefaultTrial}>
              <div className="admin-management-card-head">
                <span className="category-icon">
                  <Settings2 size={18} aria-hidden="true" />
                </span>
                <div className="admin-setting-copy">
                  <strong>مدت پیش‌فرض تست رایگان</strong>
                  <small>پایان تست هر کاربر از تاریخ ثبت‌نام خودش محاسبه می‌شود.</small>
                </div>
              </div>
              <div className="admin-setting-controls">
                <label className="admin-days-input">
                  <span>تعداد روز</span>
                  <RequiredNumberInput
                    aria-label="مدت پیش‌فرض تست رایگان"
                    min={0}
                    max={3650}
                    value={defaultTrialDays}
                    onValueChange={setDefaultTrialDays}
                  />
                </label>
                <button className="secondary-action compact" type="submit" disabled={savingDefaultTrial}>
                  <Save size={15} aria-hidden="true" />
                  {savingDefaultTrial ? "در حال ذخیره..." : "ذخیره مدت تست"}
                </button>
              </div>
              <label className="admin-bulk-checkbox">
                <input type="checkbox" checked={applyTrialToExisting} onChange={(event) => setApplyTrialToExisting(event.target.checked)} />
                <span>برای همه کاربران رایگان فعلی هم اعمال شود</span>
              </label>
            </form>

            <div className="admin-action-card">
              <div className="admin-management-card-head">
                <span className="category-icon">
                  <UsersRound size={18} aria-hidden="true" />
                </span>
                <div className="admin-setting-copy">
                  <strong>مدیریت حساب‌ها</strong>
                  <small>ایجاد حساب، نمایش موقت رمزها و دریافت نسخه اکسل.</small>
                </div>
              </div>
              <div className="admin-account-actions">
                <button className="primary-action compact" type="button" onClick={() => setCreateModalOpen(true)}>
                  <Plus size={16} aria-hidden="true" />
                  ایجاد کاربر جدید
                </button>
                <button className="secondary-action compact password-toggle" type="button" onClick={() => setShowPasswords((value) => !value)}>
                  {showPasswords ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  {showPasswords ? "مخفی کردن رمزها" : "نمایش رمزها"}
                </button>
                <button className="secondary-action compact" type="button" onClick={exportUsers} disabled={exportingUsers}>
                  <Download size={15} aria-hidden="true" />
                  {exportingUsers ? "در حال ساخت فایل..." : "دانلود اکسل کاربران"}
                </button>
              </div>
            </div>

            <form className="admin-bulk-card" onSubmit={applyBulkOperation}>
              <div className="admin-management-card-head">
                <span className="category-icon">
                  <Settings2 size={18} aria-hidden="true" />
                </span>
                <div className="admin-setting-copy">
                  <strong>عملیات گروهی کاربران</strong>
                  <small>مدیران سیستم تغییر نمی‌کنند. قبل از اجرا، تأیید نهایی نمایش داده می‌شود.</small>
                </div>
              </div>
              <div className="admin-bulk-controls">
                <label>
                  <span>کاربران هدف</span>
                  <select value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value)}>
                    <option value="free">کاربران رایگان</option>
                    <option value="pro">کاربران حرفه‌ای</option>
                    <option value="all">همه کاربران</option>
                  </select>
                </label>
                <label>
                  <span>نوع عملیات</span>
                  <select value={bulkOperation} onChange={(event) => setBulkOperation(event.target.value)}>
                    <option value="trialDays">تنظیم مدت تست</option>
                    <option value="planFree">تبدیل اشتراک به رایگان</option>
                    <option value="planPro">تبدیل اشتراک به حرفه‌ای</option>
                    <option value="unlock">باز کردن قفل ورود</option>
                  </select>
                </label>
                <label className="admin-bulk-value">
                  <span>مقدار</span>
                  {bulkOperation === "trialDays" ? (
                    <RequiredNumberInput min={0} max={3650} value={bulkTrialDays} onValueChange={setBulkTrialDays} />
                  ) : (
                    <span className="admin-bulk-value-note">نیازی به مقدار ندارد</span>
                  )}
                </label>
                <button className="primary-action" type="submit" disabled={savingBulk}>
                  {savingBulk ? "در حال اجرا..." : "اجرای عملیات"}
                </button>
              </div>
            </form>
          </div>

          <div className="admin-table-wrap scrollable-admin-table">
            {loading ? (
              <div className="table-loader">در حال بارگذاری...</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>نام کاربری</th>
                    <th>نقش</th>
                    <th>اشتراک</th>
                    <th>رمز</th>
                    <th>ثبت‌نام</th>
                    <th>آخرین ورود</th>
                    <th>تعداد ورود</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const locked = Boolean(user.lockedUntil && user.lockedUntil > now);
                    const canDelete = user.id !== currentUserId && !user.isProtected;
                    const access = getSubscriptionAccess(user, now);

                    const isExpanded = expandedUserId === user.id;

                    return (
                      <tr key={user.id} className={`user-row ${isExpanded ? "expanded" : ""}`}>
                        {/* Mobile view only: Name, Number, Plan, and Toggle Button */}
                        <td className="col-user-main">
                          <div className="user-main-info">
                            <div className="user-identity">
                              <strong>{user.displayName}</strong>
                              <small>{user.username}</small>
                            </div>
                            <div className="user-meta-badges">
                              <span className={`plan-pill ${access.plan}`}>{access.plan === "pro" ? "حرفه‌ای" : "رایگان"}</span>
                            </div>
                            <button
                              type="button"
                              className="user-expand-btn"
                              onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </td>

                        {/* Desktop view only cells */}
                        <td data-label="نام کاربری" className="col-desktop-only">
                          <strong>{user.displayName}</strong>
                          <small>{user.username}</small>
                        </td>
                        <td data-label="نقش" className="col-desktop-only">
                          <span className={`role-pill ${user.role}`}>{user.role === "admin" ? "مدیر" : "کاربر"}</span>
                        </td>
                        <td data-label="اشتراک" className="col-desktop-only">
                          <span className={`plan-pill ${access.plan}`}>{access.plan === "pro" ? "حرفه‌ای" : "رایگان"}</span>
                          <small>{access.plan === "free" ? (access.restricted ? "تست منقضی" : `${access.trialDaysRemaining} روز باقی‌مانده`) : "دسترسی کامل"}</small>
                        </td>
                        <td data-label="رمز" className="col-desktop-only">
                          <small>{showPasswords ? user.passwordPreview || "فقط قابل تغییر" : "••••••••"}</small>
                        </td>
                        <td data-label="ثبت‌نام" className="col-desktop-only">{new Date(access.signupAt).toLocaleDateString("fa-IR")}</td>
                        <td data-label="آخرین ورود" className="col-desktop-only">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("fa-IR") : "بدون ورود"}</td>
                        <td data-label="تعداد ورود" className="col-desktop-only">{user.loginCount ?? 1}</td>
                        <td data-label="وضعیت" className="col-desktop-only">{locked ? "قفل موقت" : user.isProtected ? "حساب پایه" : "فعال"}</td>
                        <td data-label="عملیات" className="col-desktop-only actions-cell">
                          <div className="admin-table-actions">
                            <button
                              type="button"
                              className="secondary-action compact icon-only-action"
                              title="ویرایش"
                              aria-label={`ویرایش ${user.username}`}
                              onClick={() => startEdit(user)}
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="danger-action compact icon-only-action"
                              title="حذف"
                              aria-label={`حذف ${user.username}`}
                              disabled={!canDelete || pendingUserId === user.id}
                              onClick={() => deleteAccount(user.id)}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </td>

                        {/* Collapsible Mobile Details */}
                        {isExpanded ? (
                          <td className="user-mobile-details">
                            <div className="mobile-details-row">
                              <span><strong>نقش:</strong> {user.role === "admin" ? "مدیر" : "کاربر"}</span>
                              <span><strong>ثبت‌نام:</strong> {new Date(access.signupAt).toLocaleDateString("fa-IR")}</span>
                              <span><strong>وضعیت:</strong> {locked ? "قفل" : "فعال"}</span>
                              <span><strong>تعداد ورود:</strong> {user.loginCount ?? 1}</span>
                              <span><strong>رمز:</strong> {showPasswords ? user.passwordPreview || "فقط قابل تغییر" : "••••••••"}</span>
                            </div>
                            <div className="mobile-details-row-actions">
                              <button
                                type="button"
                                className="secondary-action compact icon-only-action"
                                title="ویرایش"
                                aria-label={`ویرایش ${user.username}`}
                                onClick={() => startEdit(user)}
                              >
                                <Pencil size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="danger-action compact icon-only-action"
                                title="حذف"
                                aria-label={`حذف ${user.username}`}
                                disabled={!canDelete || pendingUserId === user.id}
                                onClick={() => deleteAccount(user.id)}
                              >
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 ? (
            <div className="admin-pagination">
              <button 
                type="button" 
                className="pagination-btn arrow" 
                disabled={currentPage === 1 || loading}
                onClick={() => fetchPage(currentPage - 1)}
              >
                &laquo; قبلی
              </button>

              {getPageNumbers().map((p, idx) => {
                if (p === "...") {
                  return <span key={`dots-${idx}`} className="pagination-dots">...</span>;
                }
                return (
                  <button
                    key={`page-${p}`}
                    type="button"
                    className={`pagination-btn page-num ${currentPage === p ? "active" : ""}`}
                    disabled={loading}
                    onClick={() => fetchPage(Number(p))}
                  >
                    {p}
                  </button>
                );
              })}

              <button 
                type="button" 
                className="pagination-btn arrow" 
                disabled={currentPage === totalPages || loading}
                onClick={() => fetchPage(currentPage + 1)}
              >
                بعدی &raquo;
              </button>
            </div>
          ) : null}
        </article>

        <article className="panel admin-card admin-sms-card">
          <div className="admin-section-title">
            <span className="category-icon">
              <MessageSquare size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>تنظیمات پنل پیامکی OTP</h2>
              <p>برای اتصال به سرویس واقعی پیامک</p>
            </div>
          </div>

          <form className="admin-form-grid" onSubmit={saveSmsConfig}>
            <label>
              <span>نام سرویس‌دهنده</span>
              <input value={smsConfig.providerName} onChange={(event) => setSmsConfig({ ...smsConfig, providerName: event.target.value })} />
            </label>
            <label>
              <span>آدرس API</span>
              <input dir="ltr" value={smsConfig.apiUrl} onChange={(event) => setSmsConfig({ ...smsConfig, apiUrl: event.target.value })} />
            </label>
            <label>
              <span>شماره فرستنده</span>
              <input value={smsConfig.senderNumber} onChange={(event) => setSmsConfig({ ...smsConfig, senderNumber: event.target.value })} />
            </label>
            <label>
              <span>شناسه قالب پیامک</span>
              <input value={smsConfig.templateId} onChange={(event) => setSmsConfig({ ...smsConfig, templateId: event.target.value })} />
            </label>
            <label>
              <span>کلید API</span>
              <input
                dir="ltr"
                type="password"
                placeholder={smsConfig.apiKeySet ? "کلید قبلی ذخیره شده است" : "API key"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label>
              <span>Timeout درخواست</span>
              <RequiredNumberInput
                min={3}
                max={30}
                value={smsConfig.timeoutSeconds}
                onValueChange={(value) => setSmsConfig({ ...smsConfig, timeoutSeconds: value })}
              />
            </label>
            <label className="admin-switch">
              <input
                type="checkbox"
                checked={smsConfig.enabled}
                onChange={(event) => setSmsConfig({ ...smsConfig, enabled: event.target.checked })}
              />
              <span>ارسال پیامک واقعی فعال باشد</span>
            </label>
            <button className="secondary-action" type="submit" disabled={savingSms}>
              {savingSms ? "در حال ذخیره..." : "ذخیره تنظیمات"}
            </button>
          </form>
        </article>

        <article className="panel admin-card admin-sms-card">
          <div className="admin-section-title">
            <span className="category-icon">
              <Database size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>دریافت فقط‌خواندنی WooCommerce</h2>
              <p>سایت فقط با GET خوانده می‌شود؛ ذخیره‌سازی صرفاً در دیتابیس داخلی اپ انجام می‌شود</p>
            </div>
          </div>

          <div className="admin-catalog-sync-layout">
            <div className="admin-catalog-sync-toolbar">
              <div className="admin-catalog-sync-note">
                <ShieldCheck size={19} aria-hidden="true" />
                <p>کلید WooCommerce فقط‌خواندنی است و هیچ عملیات ایجاد، ویرایش یا حذف روی سایت انجام نمی‌شود.</p>
              </div>
            <div className="admin-catalog-sync-actions">
              <button className="catalog-sync-action catalog-sync-preview" type="button" disabled={catalogSyncing !== null} onClick={() => syncCatalog(true)}>
                <span className="catalog-sync-action-icon"><RefreshCw className={catalogSyncing === "dry-run" ? "is-spinning" : ""} size={18} aria-hidden="true" /></span>
                <span><strong>{catalogSyncing === "dry-run" ? "در حال بررسی..." : "بررسی آزمایشی"}</strong><small>فقط تحلیل، بدون ذخیره</small></span>
              </button>
              <button className="catalog-sync-action catalog-sync-import" type="button" disabled={catalogSyncing !== null} onClick={() => syncCatalog(false)}>
                <span className="catalog-sync-action-icon"><CloudDownload className={catalogSyncing === "sync" ? "is-downloading" : ""} size={19} aria-hidden="true" /></span>
                <span><strong>{catalogSyncing === "sync" ? "در حال دریافت..." : "دریافت محصولات"}</strong><small>ذخیره فقط در دیتابیس اپ</small></span>
              </button>
            </div>
            </div>
            {catalogSyncRun ? <CatalogSyncProgress run={catalogSyncRun} /> : null}
            {catalogSyncResult ? (
              <div className="admin-catalog-sync-result" role="status">
                <div className="admin-catalog-result-head">
                  <span className="admin-catalog-result-icon"><CheckCircle2 size={20} aria-hidden="true" /></span>
                  <div><strong>{catalogSyncResult.dryRun ? "بررسی آزمایشی با موفقیت انجام شد" : "محصولات در دیتابیس اپ ذخیره شدند"}</strong><small>{catalogSyncResult.dryRun ? "هیچ داده‌ای تغییر نکرده است" : "منبع WooCommerce بدون تغییر باقی مانده است"}</small></div>
                  <span className="admin-readonly-badge"><ShieldCheck size={14} aria-hidden="true" />{catalogSyncResult.sourceReadOnly ? "اتصال فقط‌خواندنی" : "وضعیت نامشخص"}</span>
                </div>
                <div className="admin-catalog-result-metrics">
                  <div><small>دریافت‌شده</small><strong>{catalogSyncResult.received.toLocaleString("fa-IR")}</strong></div>
                  {!catalogSyncResult.dryRun ? <div><small>Snapshot محلی</small><strong>{catalogSyncResult.storedSourceProducts.toLocaleString("fa-IR")}</strong></div> : null}
                  <div><small>قابل استفاده</small><strong>{catalogSyncResult.normalized.toLocaleString("fa-IR")}</strong></div>
                  <div><small>نیازمند نگاشت</small><strong>{catalogSyncResult.skipped.toLocaleString("fa-IR")}</strong></div>
                  <div className={catalogSyncResult.warnings.length ? "has-warning" : ""}><small>هشدار کیفیت</small><strong>{catalogSyncResult.warnings.length.toLocaleString("fa-IR")}</strong></div>
                </div>
                {catalogSyncResult.warnings.length ? (
                  <details>
                    <summary>مشاهده هشدارهای کیفیت داده</summary>
                    <ul>
                      {catalogSyncResult.warnings.slice(0, 30).map((warning, index) => (
                        <li key={`${warning.wooId}-${index}`}><b>{warning.name}:</b> {warning.warning}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {createModalOpen ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={closeCreateModal}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <p className="eyebrow">حساب جدید</p>
                <h2 id="create-user-title">ایجاد کاربر جدید</h2>
              </div>
              <button className="icon-button" type="button" aria-label="بستن" onClick={closeCreateModal}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form className="admin-form-grid admin-modal-form" onSubmit={createAccount}>
              <label>
                <span>نام کاربری / موبایل</span>
                <input value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} required />
              </label>
              <label>
                <span>نام نمایشی</span>
                <input value={createForm.displayName} onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })} />
              </label>
              <label>
                <span>نقش</span>
                <select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value as UserRole })}>
                  <option value="user">کاربر</option>
                  <option value="admin">مدیر</option>
                </select>
              </label>
              <label>
                <span>اشتراک</span>
                <select value={createForm.plan} onChange={(event) => setCreateForm({ ...createForm, plan: event.target.value as UserPlan })}>
                  <option value="free">رایگان</option>
                  <option value="pro">حرفه‌ای</option>
                </select>
              </label>
              <label>
                <span>کل روزهای تست</span>
                <RequiredNumberInput min={0} max={3650} value={createForm.trialDays} onValueChange={(value) => setCreateForm({ ...createForm, trialDays: value })} />
              </label>
              <label>
                <span>روزهای باقی‌مانده</span>
                <RequiredNumberInput min={0} max={3650} value={createForm.daysLeft} onValueChange={(value) => setCreateForm({ ...createForm, daysLeft: value })} />
              </label>
              <label>
                <span>رمز عبور</span>
                <input
                  dir="ltr"
                  type={showPasswords ? "text" : "password"}
                  placeholder="اگر خالی باشد، موبایل رمز می‌شود"
                  value={createForm.password}
                  onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
                />
              </label>
              <div className="admin-modal-actions">
                <button className="secondary-action" type="button" onClick={closeCreateModal}>
                  انصراف
                </button>
                <button className="primary-action" type="submit" disabled={loading}>
                  <Plus size={16} aria-hidden="true" />
                  ایجاد کاربر
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingUser ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={closeEditModal}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <p className="eyebrow">ویرایش حساب</p>
                <h2 id="edit-user-title">{editingUser.username}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="بستن" onClick={closeEditModal}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form className="admin-form-grid admin-modal-form" onSubmit={saveEditedAccount}>
              <label>
                <span>نام نمایشی</span>
                <input value={editForm.displayName} onChange={(event) => setEditForm({ ...editForm, displayName: event.target.value })} />
              </label>
              <label>
                <span>نقش</span>
                <select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value as UserRole })}>
                  <option value="user">کاربر</option>
                  <option value="admin">مدیر</option>
                </select>
              </label>
              <label>
                <span>اشتراک</span>
                <select value={editForm.plan} onChange={(event) => setEditForm({ ...editForm, plan: event.target.value as UserPlan })}>
                  <option value="free">رایگان</option>
                  <option value="pro">حرفه‌ای</option>
                </select>
              </label>
              <label>
                <span>کل روزهای تست</span>
                <RequiredNumberInput min={0} max={3650} value={editForm.trialDays} onValueChange={(value) => setEditForm({ ...editForm, trialDays: value })} />
              </label>
              <label>
                <span>روزهای باقی‌مانده</span>
                <RequiredNumberInput min={0} max={3650} value={editForm.daysLeft} onValueChange={(value) => setEditForm({ ...editForm, daysLeft: value })} />
              </label>
              <label>
                <span>رمز جدید</span>
                <input dir="ltr" type={showPasswords ? "text" : "password"} value={editForm.password} onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} />
              </label>
              <p className="admin-modal-note">اگر رمز جدید را خالی بگذارید، رمز فعلی حفظ می‌شود.</p>
              <div className="admin-modal-actions">
                <button className="secondary-action" type="button" onClick={closeEditModal}>
                  انصراف
                </button>
                <button className="primary-action" type="submit" disabled={pendingUserId === editingUser.id}>
                  <Save size={16} aria-hidden="true" />
                  ذخیره کاربر
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {message ? <p className="form-message success">{message}</p> : null}
      {error ? <p className="form-message error">{error}</p> : null}
    </div>
  );
}

function CatalogSyncProgress({ run }: { run: CatalogSyncRun }) {
  const activeIndex = catalogStageOrder[run.stage] ?? 0;
  const visibleStages = run.dryRun ? catalogSyncStages.slice(0, 3) : catalogSyncStages;
  const imageTotal = run.imageCache.queued + run.imageCache.downloading + run.imageCache.completed + run.imageCache.failed;
  const imagePercent = imageTotal ? Math.round(run.imageCache.completed / imageTotal * 100) : 0;
  const statusLabel = run.status === "failed" ? "متوقف‌شده" : run.status === "success" ? "کامل شد" : run.status === "queued" ? "در صف اجرا" : catalogSyncStages[Math.min(activeIndex, catalogSyncStages.length - 1)]?.label || "در حال اجرا";
  return <section className={`catalog-sync-progress ${run.status}`} aria-live="polite">
    <div className="catalog-sync-progress-head">
      <div><span className="catalog-sync-live-dot" /><div><strong>{statusLabel}</strong><small>شناسه عملیات #{new Intl.NumberFormat("fa-IR").format(run.id)}</small></div></div>
      <strong>{new Intl.NumberFormat("fa-IR").format(run.progressPercent)}٪</strong>
    </div>
    <div className="catalog-sync-progress-track"><span style={{ width: `${run.progressPercent}%` }} /></div>
    {run.progressTotal > 0 ? <p>{new Intl.NumberFormat("fa-IR").format(run.progressCurrent)} از {new Intl.NumberFormat("fa-IR").format(run.progressTotal)} مورد پردازش شده است.</p> : <p>در حال آماده‌سازی عملیات...</p>}
    <ol className={run.dryRun ? "catalog-sync-steps dry-run" : "catalog-sync-steps"}>
      {visibleStages.map((stage, index) => {
        const completed = run.status === "success" || activeIndex > index;
        const active = run.status !== "failed" && activeIndex === index;
        return <li key={stage.key} className={completed ? "completed" : active ? "active" : ""}><span>{completed ? <CheckCircle2 size={14} /> : index + 1}</span><small>{stage.label}</small></li>;
      })}
    </ol>
    {!run.dryRun && imageTotal > 0 ? <div className="catalog-sync-image-progress"><div><strong>کش تصاویر در پس‌زمینه</strong><span>{new Intl.NumberFormat("fa-IR").format(run.imageCache.completed)} از {new Intl.NumberFormat("fa-IR").format(imageTotal)} تصویر · {new Intl.NumberFormat("fa-IR").format(imagePercent)}٪</span></div><div><i style={{ width: `${imagePercent}%` }} /></div><small>{run.imageCache.downloading > 0 ? `${new Intl.NumberFormat("fa-IR").format(run.imageCache.downloading)} تصویر در حال دریافت است` : run.imageCache.queued > 0 ? `${new Intl.NumberFormat("fa-IR").format(run.imageCache.queued)} تصویر در صف است` : run.imageCache.failed > 0 ? `${new Intl.NumberFormat("fa-IR").format(run.imageCache.failed)} تصویر ناموفق` : "تمام تصاویر دریافت شدند"}</small></div> : null}
    <div className="catalog-sync-log">
      <div><strong>گزارش زنده عملیات</strong><small>{new Intl.NumberFormat("fa-IR").format(run.logs.length)} رویداد</small></div>
      <ul>{run.logs.slice(-40).map((entry, index) => <li key={`${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{entry.message}</span></li>)}</ul>
    </div>
  </section>;
}
