import { DayView } from "@/components/DayView";
import { kstDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default function Home() {
  return <DayView date={kstDate()} />;
}
