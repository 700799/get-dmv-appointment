import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Dashboard from "./Dashboard";

export default async function DashboardPage() {
  const auth = await isAuthenticated();
  if (!auth) redirect("/");
  return <Dashboard />;
}
