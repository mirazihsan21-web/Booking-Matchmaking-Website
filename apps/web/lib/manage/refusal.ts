import { m } from '@/messages';

/**
 * Why the desk can't act on a booking: it no longer exists (`sectionId` null), or it is in a section this person
 * doesn't run — e.g. an owner narrowed their sections while their Today was open.
 */
export function deskRefusal(sectionId: string | null, mySectionIds: string[]): string {
  return sectionId && !mySectionIds.includes(sectionId) ? m.manage.desk.notYourSection : m.manage.desk.notFound;
}
