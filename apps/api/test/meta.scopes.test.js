// Which Page fields SocialHub asks Meta for, depending on the Facebook Login scopes this server
// is configured with. A Facebook-only setup (META_FACEBOOK_SCOPES without instagram_basic)
// must not ask for the linked Instagram account, which needs that permission.
import { describe, expect, it } from 'vitest';
import {
  facebookLoginIncludesInstagram,
  managedPageFields,
} from '../src/integrations/meta/facebook.js';

const facebookOnly = {
  scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  loginConfigId: null,
};
const withInstagram = {
  scopes: [...facebookOnly.scopes, 'instagram_basic', 'instagram_content_publish'],
  loginConfigId: null,
};

describe('Facebook Login scopes and Page discovery', () => {
  it('reads only Page fields when the login does not ask for Instagram', () => {
    expect(facebookLoginIncludesInstagram(facebookOnly)).toBe(false);
    const fields = managedPageFields(facebookOnly);
    expect(fields).toBe('id,name,category,tasks,access_token,picture.width(200).height(200)');
    expect(fields).not.toMatch(/instagram/);
  });

  it('also reads the linked Instagram account when instagram_basic is requested', () => {
    expect(facebookLoginIncludesInstagram(withInstagram)).toBe(true);
    expect(managedPageFields(withInstagram)).toMatch(
      /,instagram_business_account\{id,username,name,profile_picture_url\}$/,
    );
  });

  it('leaves it to a Login for Business configuration when one is used', () => {
    expect(facebookLoginIncludesInstagram({ scopes: [], loginConfigId: '123' })).toBe(true);
  });

  it('the test server keeps the default scopes, which include Instagram', () => {
    expect(facebookLoginIncludesInstagram()).toBe(true);
  });
});
