import { redirect } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import { createClient } from "../../../lib/supabase/server";
import AccountSettings from "./AccountSettings";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) redirect("/account?mode=sign-in");

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <StudioSidebar />
      <section className="min-h-screen pt-16 md:pl-[var(--studio-sidebar-width,260px)] md:pt-0">
        <AccountSettings email={data.user.email} />
      </section>
    </main>
  );
}
