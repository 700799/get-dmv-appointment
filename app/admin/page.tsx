import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Admin from "./Admin";

export default async function AdminPage() {
  const auth = await isAuthenticated();
  if (!auth) redirect("/");
  return <Admin />;
}
