import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  Check,
  CreditCard,
  Link2,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

export function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-foreground">
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <WhoItsFor />
      <FinalCTA />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/images/logo.svg" alt="Bookmi" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Bookmi</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">by Qorelly</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/auth/login"
            className="hidden sm:inline-flex items-center rounded-button px-4 py-2 text-sm font-medium text-foreground hover:bg-gray-50 transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/auth/signup"
            className="inline-flex items-center gap-1.5 rounded-button bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover active:scale-95 transition-all"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-gray-200">
      <div className="absolute inset-0 bg-gradient-to-b from-primary-light/70 to-white" aria-hidden />
      <div className="container relative py-20 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-button bg-primary-light px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" /> By Qorelly · Powered by Monnify
            </span>
            <h1 className="mt-5 font-display text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[1.05]">
              Your bookable page,
              <br />
              <span className="text-primary">in one link.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              Share <span className="font-mono text-foreground">bookmi.co/you</span>. Let anyone book
              your services and pay in seconds — money lands in your Monnify wallet, withdraw to your
              bank anytime.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/auth/signup" className="btn-primary text-base">
                Get your link <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how-it-works" className="btn-secondary text-base">
                See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> No setup fee
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> Pay out to any Nigerian bank
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> Live in 5 minutes
              </li>
            </ul>
          </div>
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function HeroPreview() {
  const services = [
    { name: "30-min consultation", duration: "30 min", price: "₦15,000" },
    { name: "Portfolio review", duration: "45 min", price: "₦25,000" },
    { name: "1:1 mentoring session", duration: "60 min", price: "₦40,000" },
  ];
  return (
    <div className="relative">
      <div className="card-elevated overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="ml-2 flex-1 rounded-button border border-gray-200 bg-white px-3 py-1 font-mono text-xs text-muted-foreground">
            bookmi.co/adaeze
          </span>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-lg font-semibold text-primary">
              A
            </div>
            <div>
              <div className="font-semibold">Adaeze O.</div>
              <div className="text-xs text-muted-foreground">Brand strategist · Lagos</div>
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            {services.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between rounded-button border border-gray-200 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.duration}</div>
                </div>
                <div className="text-sm font-semibold">{s.price}</div>
              </div>
            ))}
          </div>
          <button className="btn-primary mt-5 w-full">Book &amp; pay</button>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> Secure payment via Monnify
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-2xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-lg text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Link2,
      title: "Create your page",
      body: "Sign up, pick your slug, and list your services with fixed prices or pay-what-you-want.",
    },
    {
      icon: Users,
      title: "Share your link",
      body: "Drop bookmi.co/you in your bio, DMs, or invoices. Anyone can browse and book — no app, no account needed.",
    },
    {
      icon: Wallet,
      title: "Get booked & paid",
      body: "Customers pay instantly via Monnify. Funds land in your wallet minus a small platform fee. Withdraw to your bank anytime.",
    },
  ];
  return (
    <section id="how-it-works" className="border-b border-gray-200">
      <div className="container py-20">
        <SectionHeading
          eyebrow="How it works"
          title="From sign-up to booked in 5 minutes"
          subtitle="No website to build, no payment gateway to wire. Just a link that does the work."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-button bg-primary-light text-primary">
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="mt-4 font-display text-xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: CreditCard,
      title: "Monnify payments",
      body: "Cards, bank transfers, and USSD — customers pay however they want, instantly.",
    },
    {
      icon: Wallet,
      title: "Instant payouts",
      body: "Withdraw your balance to any Nigerian bank account in one tap.",
    },
    {
      icon: Calendar,
      title: "Bookings calendar",
      body: "See every booking in a clean calendar view and manage availability without the back-and-forth.",
    },
    {
      icon: Sparkles,
      title: "Fixed or pay-what-you-want",
      body: "Set fixed prices or let happy clients pay more with a floor you control.",
    },
    {
      icon: Link2,
      title: "One shareable link",
      body: "Your whole offering lives at bookmi.co/you. Put it anywhere — bio, receipt, WhatsApp status.",
    },
    {
      icon: Check,
      title: "Confirmed by webhook",
      body: "Bookings confirm the moment Monnify verifies payment. No manual checks, no fake orders.",
    },
  ];
  return (
    <section className="border-b border-gray-200 bg-gray-50/50">
      <div className="container py-20">
        <SectionHeading
          eyebrow="Features"
          title="Everything you need to get paid for your time"
          subtitle="Bookmi handles the booking, the payment, and the payout — so you can focus on the work."
        />
        <div className="mt-12 grid gap-px overflow-hidden border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-white p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-button bg-primary-light text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-xl">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhoItsFor() {
  const audiences = [
    "Consultants",
    "Tutors",
    "Stylists",
    "Therapists",
    "Creatives",
    "Coaches",
    "Lawyers",
    "Trainers",
  ];
  return (
    <section className="border-b border-gray-200">
      <div className="container py-20">
        <SectionHeading
          eyebrow="Who it's for"
          title="Built for Nigeria's independent pros"
          subtitle="If you sell your time or a paid service, Bookmi is the link your clients need."
        />
        <div className="mt-10 flex flex-wrap gap-2.5">
          {audiences.map((a) => (
            <span
              key={a}
              className="rounded-button border border-gray-200 bg-white px-4 py-2 text-sm font-medium"
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="border-b border-gray-200 bg-primary text-white">
      <div className="container py-20 text-center">
        <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
          Get your bookmi link today.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-primary-light opacity-90">
          Free to set up. Live in five minutes. Start getting booked.
        </p>
        <Link
          to="/auth/signup"
          className="mt-8 inline-flex items-center gap-2 rounded-button bg-white px-6 py-3 font-medium text-primary transition-all hover:bg-gray-100 active:scale-95"
        >
          Create your page <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-white">
      <div className="container flex flex-col items-center justify-between gap-4 py-10 sm:flex-row">
        <div className="flex items-center gap-2">
          <img src="/images/logo.svg" alt="Bookmi" className="h-7 w-7" />
          <span className="font-semibold">Bookmi</span>
          <span className="text-xs text-muted-foreground">· by Qorelly</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link to="/auth/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link to="/auth/signup" className="hover:text-foreground">
            Get started
          </Link>
          <span>© {new Date().getFullYear()} Qorelly</span>
        </div>
      </div>
    </footer>
  );
}
