// Google Cast (Chromecast) via the free Web Sender SDK. Loaded lazily, Chromium browsers only.

let ready = null;

export function castAvailable() {
  return !!window.chrome && !/iPhone|iPad|Firefox/i.test(navigator.userAgent);
}

export function loadCast() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (!castAvailable()) return resolve(false);
    window.__onGCastApiAvailable = (ok) => {
      if (!ok || !window.cast?.framework) return resolve(false);
      cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      resolve(true);
    };
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.async = true;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(false), 8000);
  });
  return ready;
}

/** Start casting `url` at `time`. Resolves true when the receiver accepted the media. */
export async function castMedia({ url, title, subtitle, image, time = 0 }) {
  if (!(await loadCast())) return false;
  const ctx = cast.framework.CastContext.getInstance();
  try {
    if (!ctx.getCurrentSession()) await ctx.requestSession();
  } catch {
    return false;
  }
  const info = new chrome.cast.media.MediaInfo(url, 'video/mp4');
  info.metadata = new chrome.cast.media.MovieMediaMetadata();
  info.metadata.title = title;
  info.metadata.subtitle = subtitle || '';
  if (image) info.metadata.images = [new chrome.cast.Image(image)];
  const req = new chrome.cast.media.LoadRequest(info);
  req.currentTime = time;
  req.autoplay = true;
  try {
    await ctx.getCurrentSession().loadMedia(req);
    return true;
  } catch {
    return false;
  }
}

export function onCastEnd(fn) {
  if (!window.cast?.framework) return () => {};
  const ctx = cast.framework.CastContext.getInstance();
  const h = (e) => e.sessionState === cast.framework.SessionState.SESSION_ENDED && fn();
  ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, h);
  return () => ctx.removeEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, h);
}
