import { DayView } from "@/components/DayView";
import { isValidMonth, kstDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const m = typeof sp.m === "string" && isValidMonth(sp.m) ? sp.m : undefined;
  return <DayView date={kstDate()} month={m} />;
}
