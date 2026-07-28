import { ServicePage } from "@/components/marketing/service-page";
import { serviceMetadata } from "@/lib/service-content";

export const metadata = serviceMetadata("solar");

export default function Page() {
  return <ServicePage slug="solar" />;
}
