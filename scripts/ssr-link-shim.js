import React from 'react';

/** SSR stand-in for react-router Link. Real client bundle is unchanged. */
export function Link({ to, children, ...rest }) {
  const href = typeof to === 'string' ? to : to?.pathname || '/';
  return React.createElement('a', { ...rest, href }, children);
}
