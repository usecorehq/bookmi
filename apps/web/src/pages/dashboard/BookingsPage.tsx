import { PageHeader } from "@/components/layouts/DashboardLayout";

export default function BookingsPage() {
  return (
    <div>
      <PageHeader title="Bookings" subtitle="All bookings and tips, plus a live calendar view." />
      <div className="text-sm text-muted-foreground">Coming up.</div>
    </div>
  );
}
