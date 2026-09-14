import { notFound } from "next/navigation";
import { DayView } from "@/components/DayView";
import { isValidDate, isValidMonth } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function DayPage({ params, searchParams }: PageProps<"/d/[date]">) {
  const [{ date }, sp] = await Promise.all([params, searchParams]);
  if (!isValidDate(date)) notFound();
  const m = typeof sp.m === "string" && isValidMonth(sp.m) ? sp.m : undefined;
  const p = typeof sp.p === "string" && /^\d+$/.test(sp.p) ? Number(sp.p) : 1;
  return <DayView date={date} month={m} page={p} />;
}

export async function generateMetadata({ params }: PageProps<"/d/[date]">) {
  const { date } = await params;
  return { title: `${date} 요약` };
}
