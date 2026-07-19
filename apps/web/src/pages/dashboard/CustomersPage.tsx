import { PageHeader } from "@/components/layouts/DashboardLayout";

export default function CustomersPage() {
  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone who has booked or tipped you." />
      <div className="text-sm text-muted-foreground">Coming up.</div>
    </div>
  );
}
