import { DayView } from "@/components/DayView";
import { isValidMonth, kstDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const m = typeof sp.m === "string" && isValidMonth(sp.m) ? sp.m : undefined;
  const p = typeof sp.p === "string" && /^\d+$/.test(sp.p) ? Number(sp.p) : 1;
  return <DayView date={kstDate()} month={m} page={p} />;
}
