import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Clock, Coffee, CalendarDays, MapPin, Phone } from "lucide-react";
import type { PublicServiceView } from "@bookmi/shared-types";
import { CheckoutDrawer } from "@/components/checkout/CheckoutDrawer";
import { usePublicHost, usePublicService } from "@/hooks/usePublicHost";
import { formatNaira } from "@/lib/utils";

/**
 * Public routes:
 *   /:slug                 → host + all active services
 *   /:slug/:serviceSlug    → same layout but opens the drawer pre-selected
 *
 * Anonymous — no auth required. The CheckoutDrawer handles both booking +
 * tip flows in one component, branching on service.type.
 */
export default function HostPublicPage() {
  const { slug, serviceSlug } = useParams<{ slug: string; serviceSlug?: string }>();
  const hostQ = usePublicHost(slug);
  const serviceQ = usePublicService(slug, serviceSlug);

  const [selectedService, setSelectedService] = useState<PublicServiceView | null>(null);

  // If we landed on /:slug/:serviceSlug, auto-open the drawer once the service
  // resolves. Only run on first load — closing the drawer shouldn't re-open it.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!autoOpened && serviceSlug && serviceQ.data?.service) {
      setSelectedService(serviceQ.data.service);
      setAutoOpened(true);
    }
  }, [autoOpened, serviceSlug, serviceQ.data]);

  if (hostQ.isPending) {
    return <PageShell><div className="text-sm text-muted-foreground">Loading…</div></PageShell>;
  }
  if (hostQ.isError || !hostQ.data) {
    return (
      <PageShell>
        <div className="card p-8 text-center">
          <h1 className="text-xl font-semibold mb-1">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            This bookmi page doesn't exist — check the link and try again.
          </p>
        </div>
      </PageShell>
    );
  }

  const { host, services } = hostQ.data;
  const bookings = services.filter((s) => s.type === "booking");
  const tips = services.filter((s) => s.type === "tip");

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto py-10">
        <HostHeader host={host} />

        <div className="mt-8 space-y-8">
          {bookings.length > 0 && (
            <ServiceGroup
              icon={<CalendarDays className="w-4 h-4" />}
              title="Book an appointment"
              services={bookings}
              onSelect={setSelectedService}
              ctaLabel="Book"
            />
          )}
          {tips.length > 0 && (
            <ServiceGroup
              icon={<Coffee className="w-4 h-4" />}
              title="Support the host"
              services={tips}
              onSelect={setSelectedService}
              ctaLabel="Send tip"
            />
          )}
          {services.length === 0 && (
            <div className="card p-8 text-center text-sm text-muted-foreground">
              {host.displayName} hasn't listed anything yet.
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-12">
          Powered by Bookmi · Qorelly
        </p>
      </div>

      {selectedService && (
        <CheckoutDrawer
          host={host}
          service={selectedService}
          onClose={() => setSelectedService(null)}
        />
      )}
    </PageShell>
  );
}

function HostHeader({ host }: { host: NonNullable<ReturnType<typeof usePublicHost>["data"]>["host"] }) {
  const initials = host.displayName
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="text-center">
      <div
        className="w-20 h-20 mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white"
        style={{
          backgroundColor: host.accentColor ?? "#7856FF",
          backgroundImage: host.avatarUrl ? `url(${host.avatarUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!host.avatarUrl && initials}
      </div>
      <h1 className="text-2xl font-bold">{host.displayName}</h1>
      <div className="text-sm text-muted-foreground">book.me/{host.slug}</div>
      {host.bio && <p className="text-sm mt-3 max-w-md mx-auto">{host.bio}</p>}
      {(host.phone || host.address) && (
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          {host.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" />
              {host.phone}
            </span>
          )}
          {host.address && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {host.address}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceGroup({
  icon,
  title,
  services,
  onSelect,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  services: PublicServiceView[];
  onSelect: (s: PublicServiceView) => void;
  ctaLabel: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="space-y-3">
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => onSelect(service)}
            className="card p-5 w-full text-left hover:border-primary transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold">{service.title}</div>
                {service.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {service.description}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-3 text-sm">
                  <span className="font-semibold">
                    {service.payWhatYouWant
                      ? service.priceKobo > 0
                        ? `From ${formatNaira(service.priceKobo)}`
                        : "Pay what you want"
                      : formatNaira(service.priceKobo)}
                  </span>
                  {service.type === "booking" && service.durationMinutes != null && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(service.durationMinutes)}
                    </span>
                  )}
                </div>
              </div>
              <span className="btn-primary shrink-0">{ctaLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4">
      <div className="max-w-3xl mx-auto">{children}</div>
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
