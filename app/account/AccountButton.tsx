"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function AccountButton({ className = "" }: { className?: string }) {
  const [avatar, setAvatar] = useState("");
  const [initial, setInitial] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      setAvatar(String(user.user_metadata.avatar_url ?? ""));
      setInitial(String(user.user_metadata.full_name ?? user.email ?? "A").charAt(0).toUpperCase());
    });
  }, []);

  return <Link href="/account" aria-label="Account" className={initial ? `inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#FFDF00]/35 bg-[#FFDF00]/10 text-[11px] font-black text-[#FFDF00] ${className}` : `rounded-full border border-white/10 px-3 py-2 text-[8px] text-white/45 hover:border-[#FFDF00]/30 hover:text-[#FFDF00] ${className}`}>{initial ? (avatar ? <img src={avatar} alt="Account avatar" className="h-full w-full object-cover" /> : initial) : "ACCOUNT"}</Link>;
}
