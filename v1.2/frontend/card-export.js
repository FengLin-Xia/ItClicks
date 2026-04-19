/**
 * 将文案渲染为卡片图并带水印，触发下载
 * 刷流卡片、自定义结果页共用
 */
(function () {
    var WATERMARK = 'It Clicks';
    var CARD_WIDTH = 560;
    var PADDING_X = 28;
    var PADDING_Y = 32;
    var LINE_HEIGHT = 2;
    var FONT_SIZE = 17;
    var FONT = FONT_SIZE + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    var TEXT_COLOR = '#2c2c2c';
    var WATERMARK_COLOR = '#ccc';
    var WATERMARK_FONT = '12px -apple-system, "PingFang SC", sans-serif';
    var WATERMARK_GAP = 16;

    function wrapLines(ctx, text, maxWidth) {
        if (!text) return [];
        var chars = Array.from(text);
        var lines = [];
        var current = '';
        for (var i = 0; i < chars.length; i++) {
            var test = current + chars[i];
            var metrics = ctx.measureText(test);
            if (metrics.width > maxWidth && current.length > 0) {
                lines.push(current);
                current = chars[i];
            } else {
                current = test;
            }
        }
        if (current) lines.push(current);
        return lines;
    }

    function drawCard(ctx, text) {
        var maxTextWidth = CARD_WIDTH - PADDING_X * 2;
        ctx.font = FONT;
        var lines = wrapLines(ctx, text, maxTextWidth);
        var lineHeightPx = FONT_SIZE * LINE_HEIGHT;
        var textBlockHeight = lines.length * lineHeightPx;
        ctx.font = WATERMARK_FONT;
        var watermarkHeight = 14 + WATERMARK_GAP;
        var cardHeight = PADDING_Y * 2 + textBlockHeight + watermarkHeight;
        var canvasWidth = CARD_WIDTH + 40;
        var canvasHeight = cardHeight + 40;

        var canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        var c = canvas.getContext('2d');

        c.fillStyle = '#fafafa';
        c.fillRect(0, 0, canvasWidth, canvasHeight);

        var cardX = 20;
        var cardY = 20;
        var r = 16;
        c.fillStyle = '#fff';
        c.shadowColor = 'rgba(0,0,0,0.06)';
        c.shadowBlur = 20;
        c.shadowOffsetY = 2;
        c.beginPath();
        c.moveTo(cardX + r, cardY);
        c.lineTo(cardX + CARD_WIDTH - r, cardY);
        c.quadraticCurveTo(cardX + CARD_WIDTH, cardY, cardX + CARD_WIDTH, cardY + r);
        c.lineTo(cardX + CARD_WIDTH, cardY + cardHeight - r);
        c.quadraticCurveTo(cardX + CARD_WIDTH, cardY + cardHeight, cardX + CARD_WIDTH - r, cardY + cardHeight);
        c.lineTo(cardX + r, cardY + cardHeight);
        c.quadraticCurveTo(cardX, cardY + cardHeight, cardX, cardY + cardHeight - r);
        c.lineTo(cardX, cardY + r);
        c.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
        c.closePath();
        c.fill();
        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        c.font = FONT;
        c.fillStyle = TEXT_COLOR;
        c.textBaseline = 'top';
        var y = cardY + PADDING_Y;
        for (var j = 0; j < lines.length; j++) {
            c.fillText(lines[j], cardX + PADDING_X, y);
            y += lineHeightPx;
        }

        c.font = WATERMARK_FONT;
        c.fillStyle = WATERMARK_COLOR;
        c.textBaseline = 'bottom';
        var wmWidth = c.measureText(WATERMARK).width;
        var wmX = cardX + (CARD_WIDTH - wmWidth) / 2;
        c.fillText(WATERMARK, wmX, cardY + cardHeight - WATERMARK_GAP);

        return canvas;
    }

    function downloadCanvas(canvas, filename) {
        var link = document.createElement('a');
        link.download = filename || 'card.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    window.exportCardImage = function (text, filename) {
        if (!text || !text.trim()) return;
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var cardCanvas = drawCard(ctx, text.trim());
        downloadCanvas(cardCanvas, filename || '这也能代.png');
    };
})();
