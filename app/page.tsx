import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-black">
      <Image
        src="/studio-bg.jpeg"
        alt="Film studio"
        fill
        priority
        className="object-cover object-center"
      />

      <div className="absolute inset-0 bg-black/65" />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.18)_42%,rgba(0,0,0,0.8)_100%)]" />

      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-8 text-center text-white sm:px-8 sm:py-10">
        <Image
          src="/logo-carabasai.svg"
          alt="Carabasai logo"
          width={160}
          height={160}
          priority
          className="mb-6 h-auto w-20 sm:mb-8 sm:w-24 md:w-28 lg:w-32"
        />

        <h1 className="w-full text-[clamp(2.8rem,10vw,9rem)] font-black leading-[0.8] tracking-[-0.075em] text-white">
          CARABASAI
        </h1>

        <h2 className="mt-3 w-full text-[clamp(3.6rem,13vw,11rem)] font-black leading-[0.78] tracking-[-0.075em] text-[#FFDF00]">
          STUDIO
        </h2>

        <p className="mt-8 text-[clamp(0.72rem,1.5vw,1.25rem)] font-semibold uppercase tracking-[0.22em] text-white/80 sm:tracking-[0.34em]">
          Welcome back, <span className="text-[#FFDF00]">Director</span>
        </p>

        <Link
          href="/studio"
          className="mt-10 flex h-12 items-center justify-center rounded-full bg-[#FFDF00] px-8 text-sm font-black uppercase tracking-[0.14em] text-black transition duration-200 hover:-translate-y-1 hover:bg-[#ffe03d]"
        >
          Enter Studio
        </Link>
      </section>
    </main>
  );
}