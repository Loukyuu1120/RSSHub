import { Route, ViewType } from '@/types';
import { parseDate } from '@/utils/parse-date';
import sanitizeHtml from 'sanitize-html';
import logger from '@/utils/logger';
import cache from '@/utils/cache';
import { config } from '@/config';
import got from '@/utils/got';

export const route: Route = {
    path: '/user/:id',
    categories: ['social-media'],
    example: '/sotwe/user/_RSSHub',
    parameters: {
        id: 'Twitter username',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
    },
    radar: [
        {
            source: ['www.sotwe.com/:id'],
            target: '/user/:id',
        },
    ],
    name: 'User timeline - Sotwe',
    maintainers: ['TonyRL'],
    handler,
    view: ViewType.Pictures,
};

const renderMedia = (mediaEntities) =>
    mediaEntities
        .map((e) => {
            switch (e.type) {
                case 'photo':
                    return `<img src="${e.mediaURL}">`;
                case 'video': {
                    const video = e.videoInfo.variants.filter((v) => v.type === 'video/mp4').toSorted((a, b) => b.bitrate - a.bitrate)[0];
                    return `<video controls preload="metadata" poster="${e.mediaURL}"><source src="${video.url}" type="video/mp4"></video>`;
                }
                default:
                    return '';
            }
        })
        .join('<br>');

const renderDescription = (item) =>
    `${renderMedia(item.mediaEntities)}<br>${item.text.replaceAll('\n', '<br>')}${item.quotedStatus ? `<br>${renderDescription(item.quotedStatus)}` : ''}${item.retweetedStatus ? `<br>${renderDescription(item.retweetedStatus)}` : ''}`;

async function handler(ctx) {
    const baseUrl = 'https://www.sotwe.com';
    const { id } = ctx.req.param();
    const apiUrl = `${baseUrl}/api/v3/user/${id}/`;

    const data = await cache.tryGet(
        `sotwe:user:${id}`,
        async () => {
            logger.http(`Requesting via FlareSolverr: ${apiUrl}`);

            const flaresolverrUrl = process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191'; // ✅ API Url
            const session = process.env.FLARESOLVERR_SESSION || 'default_session'; // ✅ 固定 session

            // 调用 Flaresolverr
            const { data: res } = await got.post(flaresolverrUrl + '/v1', {
                json: {
                    cmd: 'request.get',
                    url: apiUrl,
                    session,               // 固定 session
                    maxTimeout: 60000,
                },
                responseType: 'json',
            });

            if (!res || res.status !== 'ok') {
                throw new Error('Flaresolverr request failed: ' + JSON.stringify(res));
            }

            const body = res.solution.response;
            let jsonData = {};
            const preStart = body.indexOf('<pre>');
            const preEnd = body.indexOf('</pre>');
            if (preStart !== -1 && preEnd !== -1) {
                const jsonStr = body.substring(preStart + 5, preEnd);
                try {
                    jsonData = JSON.parse(jsonStr);
                } catch (e) {
                    logger.error('JSON parse error from Flaresolverr:', e);
                }
            }

            return jsonData;
        },
        config.cache.routeExpire,
        false
    );

    const items = (data.data || []).map((item) => ({
        title: sanitizeHtml(item.text.split('\n')[0], { allowedTags: [], allowedAttributes: {} }),
        description: renderDescription(item),
        link: `https://x.com/${id}/status/${item.id}`,
        pubDate: parseDate(item.createdAt, 'x'),
    }));

    return {
        title: `Twitter - ${data.info.name} @${data.info.screenName}`,
        description: data.info.description,
        link: `${baseUrl}/${id}`,
        image: data.info.profileImageThumbnail,
        item: items,
    };
}
