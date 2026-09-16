import { redirect } from 'next/navigation';

export default function NewDocumentRedirect() {
  redirect('/app#compose');
}
