import { describe, expect, it } from 'vitest';
import { firstIssue, loginSchema, newsSchema, registerSchema, weighInSchema } from './validators';

describe('validators mirror backend schemas', () => {
  it('login: bad email rejected', () => {
    expect(firstIssue(loginSchema, { email: 'nope', password: 'x' })).not.toBeNull();
    expect(firstIssue(loginSchema, { email: 'a@b.cc', password: 'x' })).toBeNull();
  });
  it('register: organizer/admin roles + >72b passwords rejected', () => {
    expect(firstIssue(registerSchema, { email: 'a@b.cc', password: '123456', full_name: '', role: 'organizer' })).not.toBeNull();
    expect(firstIssue(registerSchema, { email: 'a@b.cc', password: 'x'.repeat(100), full_name: '', role: 'coach' })).not.toBeNull();
    expect(firstIssue(registerSchema, { email: 'a@b.cc', password: '123456', full_name: '', role: 'coach' })).toBeNull();
  });
  it('weigh-in: 20–250 enforced client-side', () => {
    expect(firstIssue(weighInSchema, { weigh_in_kg: 19 })).not.toBeNull();
    expect(firstIssue(weighInSchema, { weigh_in_kg: 251 })).not.toBeNull();
    expect(firstIssue(weighInSchema, { weigh_in_kg: 68.5 })).toBeNull();
  });
  it('news slug: no slashes/dots/spaces, cyrillic allowed (editor output)', () => {
    expect(firstIssue(newsSchema, { title: 'Заголовок новости', slug: '../../x', excerpt: '', body: '', category: 'events' })).not.toBeNull();
    expect(firstIssue(newsSchema, { title: 'Заголовок новости', slug: 'новость-кубка', excerpt: '', body: '', category: 'events' })).toBeNull();
    expect(firstIssue(newsSchema, { title: 'Cup', slug: 't5-results-123', excerpt: '', body: '', category: 'events' })).toBeNull();
  });
});
