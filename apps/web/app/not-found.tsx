import { Unavailable } from "@/components/unavailable";

// Also catches notFound() from the tenant layout (a layout's notFound goes to its parent boundary).
export default function NotFound() {
  return <Unavailable />;
}
