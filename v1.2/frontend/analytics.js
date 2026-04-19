/**
 * 埋点 v0.1-impl：device_id / session_id / track()
 * 无登录：user_id = device_id；session_id 每次页面 load 新生成（不持久化）
 */
(function () {
    var APP_VERSION = '1.2.0';
    var PLATFORM = 'web';

    function uuid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 3) | 8;
            return v.toString(16);
        });
    }

    function getOrCreate(key, creator) {
        try {
            var v = localStorage.getItem(key);
            if (!v) {
                v = creator();
                localStorage.setItem(key, v);
            }
            return v;
        } catch (e) {
            return creator();
        }
    }

    var device_id = getOrCreate('itclicks_device_id', uuid);
    // 每次页面 load 新 session（不写 localStorage）
    var session_id = uuid();

    function basePayload(event, properties, request_id) {
        return {
            event: event,
            ts: Date.now(),
            user_id: device_id,
            device_id: device_id,
            session_id: session_id,
            page: (typeof window !== 'undefined' && window.__PAGE__) ? window.__PAGE__ : 'unknown',
            app_version: APP_VERSION,
            platform: PLATFORM,
            request_id: request_id || null,
            properties: properties || {}
        };
    }

    function track(event, properties, request_id) {
        var payload = basePayload(event, properties, request_id);
        try {
            fetch('/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(function () {});
        } catch (e) {}
    }

    window.Analytics = {
        track: track,
        uuid: uuid,
        device_id: device_id,
        session_id: session_id
    };
})();
