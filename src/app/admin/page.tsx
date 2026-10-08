import { redirect } from "next/navigation";
import { AdminPanel } from "@/src/components/AdminPanel";
import type { AdminUser } from "@/src/components/AdminPanel";
import { ensureAuthSchema, getDefaultTrialDays, getSmsConfig } from "@/src/lib/authStore";
import { getCurrentSession } from "@/src/lib/session";
import { query } from "@/src/lib/db";

export default async function AdminPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role !== "admin") {
    redirect("/");
  }

  let initialUsers: AdminUser[] = [];
  let totalUsers = 0;
  let totalPages = 1;
  let defaultTrialDays = 7;

  try {
    await ensureAuthSchema();
    defaultTrialDays = await getDefaultTrialDays();
    const usersResult = await query(`
      SELECT id, username, role, plan, is_free_account as "isFreeAccount", 
             display_name as "displayName", signup_at as "signupAt", 
             created_at as "createdAt", last_login_at as "lastLoginAt", 
             login_count as "loginCount",
             failed_logins as "failedLogins", is_protected as "isProtected",
             trial_days as "trialDays", password_preview as "passwordPreview"
      FROM users
      ORDER BY is_protected DESC, signup_at DESC
      LIMIT 50 OFFSET 0
    `);
    const countResult = await query("SELECT COUNT(*) FROM users");
    totalUsers = parseInt(countResult.rows[0].count);
    totalPages = Math.ceil(totalUsers / 50);

    initialUsers = usersResult.rows.map(row => ({
      ...row,
      signupAt: row.signupAt ? new Date(row.signupAt).toISOString() : undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
      lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : undefined
    }));
  } catch (err) {
    console.error("Failed to load initial users in AdminPage:", err);
  }

  return (
    <main className="app-shell">
      <AdminPanel 
        currentUserId={session.id} 
        initialUsers={initialUsers} 
        initialTotalUsers={totalUsers}
        initialTotalPages={totalPages}
        initialDefaultTrialDays={defaultTrialDays}
        initialSmsConfig={getSmsConfig()} 
      />
    </main>
  );
}
