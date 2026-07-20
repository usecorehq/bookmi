import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FormMessage } from "@/components/ui/FormMessage";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import type {
  DayHours,
  HostProfile,
  HostWallet,
  OperatingHours,
} from "@bookmi/shared-types";

type ProfileWithWallet = HostProfile & { wallet: HostWallet | null };

const WEEKDAYS: Array<keyof OperatingHours> = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function HoursSection({ profile }: { profile: ProfileWithWallet }) {
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<OperatingHours>(() => profile.operatingHours);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHours(profile.operatingHours);
  }, [profile.operatingHours]);

  const hasChanges = useMemo(
    () => JSON.stringify(hours) !== JSON.stringify(profile.operatingHours),
    [hours, profile.operatingHours],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ profile: HostProfile }>("/hosts/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ operatingHours: hours }),
      });
      return res.profile;
    },
    onSuccess: async () => {
      toast.success("Saved");
      setError(null);
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ["host-wallet"] });
    },
    onError: (err) => {
      setError(readError(err));
    },
  });

  const canSave = hasChanges && !saveMutation.isPending;

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Operating hours</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Feeds the customer wizard's calendar.
        </p>
      </div>

      <div className="space-y-2">
        {WEEKDAYS.map((day) => (
          <HoursRow
            key={day}
            day={day}
            value={hours[day]}
            onChange={(v) => setHours({ ...hours, [day]: v })}
          />
        ))}
      </div>

      {error && <FormMessage variant="error" message={error} className="mt-4" />}

      <div className="flex justify-end pt-4">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => saveMutation.mutate()}
          className="btn-primary"
        >
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function HoursRow({
  day,
  value,
  onChange,
}: {
  day: keyof OperatingHours;
  value: DayHours;
  onChange: (v: DayHours) => void;
}) {
  return (
    <div className="grid grid-cols-[7rem_auto_1fr_auto_1fr] items-center gap-3">
      <label className="text-sm font-medium capitalize">{day}</label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!value.closed}
          onChange={(e) => onChange({ ...value, closed: !e.target.checked })}
        />
        Open
      </label>
      <input
        type="time"
        value={value.open}
        onChange={(e) => onChange({ ...value, open: e.target.value })}
        disabled={value.closed}
        className="input-field !min-h-[36px] !py-1"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="time"
        value={value.close}
        onChange={(e) => onChange({ ...value, close: e.target.value })}
        disabled={value.closed}
        className="input-field !min-h-[36px] !py-1"
      />
    </div>
  );
}

function readError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string") return m;
      if (Array.isArray(m)) return m.join(", ");
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
