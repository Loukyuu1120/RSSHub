import sanitizeHtml from 'sanitize-html';

import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import { parseDate } from '@/utils/parse-date';
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
    `${renderMedia(item.mediaEntities)}<br>${item.text.replaceAll('\n', '<br>')}${item.quotedStatus ? `<br>${renderDescription(item.quotedStatus)}` : ''}${item.retweetedStatus ? `<br>${renderDescription(item.retweetedStatus)}` : ''}${(item.conversation || []).map((c) => `<br>${renderDescription(c)}`).join('')}`;

async function handler(ctx) {
    const baseUrl = 'https://www.sotwe.com';
    const { id } = ctx.req.param();
    const apiUrl = `${baseUrl}/api/v3/user/${id}/`;

    const data = await cache.tryGet(
        `sotwe:user:${id}`,
        async () => {
            logger.http(`Requesting via FlareSolverr (shared cookies, no session): ${apiUrl}`);

            const flaresolverrUrl = process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191';

            // ✅ cookies 共享
            const globalCookieKey = 'flaresolverr:cookies:shared';
            // const sharedCookies = (await cache.get(globalCookieKey)) || [];

            const { data: res } = await got.post(`${flaresolverrUrl}/v1`, {
                json: {
                    cmd: 'request.get',
                    url: apiUrl,
                    // cookies: sharedCookies, // 使用全局 cookies
                    maxTimeout: 60000,
                },
                responseType: 'json',
            });

            if (!res || res.status !== 'ok' || !res.solution?.response) {
                throw new Error('Flaresolverr request failed: ' + JSON.stringify(res));
            }

            // ✅ 更新 cookies（仅当返回有 cookies）
            // if (res.solution.cookies?.length) {
            //     await cache.set(globalCookieKey, res.solution.cookies, 4000);
            //     logger.debug('Updated shared cookies for FlareSolverr');
            // }

            // ✅ 解析返回内容
            const body = res.solution.response;
            let jsonData = {};
            const preStart = body.indexOf('<pre>');
            const preEnd = body.indexOf('</pre>');
            if (preStart !== -1 && preEnd !== -1) {
                const jsonStr = body.substring(preStart + 5, preEnd);
                try {
                    jsonData = JSON.parse(jsonStr);
                } catch (error) {
                    logger.error('JSON parse error from FlareSolverr:', error);
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
        allowEmpty: true,
    };
}
