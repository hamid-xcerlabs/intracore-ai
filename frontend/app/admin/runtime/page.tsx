import { AdminRuntimeShell } from "../../../components/admin-runtime-shell";

export const metadata = {
  title: "Runtime status | IntraCore AI",
  description: "Inspect local IntraCore AI runtime readiness.",
};

export default function AdminRuntimePage() {
  return <AdminRuntimeShell />;
}
