import { redirect } from 'next/navigation';

/** App entry = product hub, not a marketing brochure. */
export default function RootPage() {
  redirect('/hub');
}
