import { ServicePage } from "@/components/marketing/service-page";
import { serviceMetadata } from "@/lib/service-content";

export const metadata = serviceMetadata("storm-restoration");

export default function Page() {
  return <ServicePage slug="storm-restoration" />;
}
