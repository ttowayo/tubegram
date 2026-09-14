import { notFound } from "next/navigation";
import { DayView } from "@/components/DayView";
import { isValidDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function DayPage({ params }: PageProps<"/d/[date]">) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();
  return <DayView date={date} />;
}
