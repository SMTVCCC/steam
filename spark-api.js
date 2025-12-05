// spark-api.js
// 星火API通信模块

// 防止重复定义，检查是否已存在sparkAPI对象
if (!window.sparkAPI) {
    console.log('创建新的 sparkAPI 对象');
    // 创建一个全局对象来处理星火API的通信
    window.sparkAPI = {
        ws: null,
        appId: '',
        apiKey: '',
        apiSecret: '',
        uid: '',
        url: '',
        domain: '',
        responseCallback: null,
        messageBuffer: '', // 添加消息缓冲区
        isFirstConnect: true, // 新增标记，用于跟踪是否是首次连接
        hasConnected: false, // 跟踪是否成功连接过
        
        // 初始化API配置
        init(config) {
            this.appId = config.appId;
            this.apiKey = config.apiKey;
            this.apiSecret = config.apiSecret;
            this.uid = config.uid;
            this.url = config.url;
            this.domain = config.domain;
            console.log('星火API初始化完成');
            
            // 初始化时预先连接WebSocket，但不显示错误
            this.connect(true);
        },
        
        // 设置响应回调函数
        setResponseCallback(callback) {
            this.responseCallback = callback;
        },
        
        // 生成认证URL
        generateAuthUrl() {
            const date = new Date().toGMTString();
            const signatureOrigin = `host: spark-api.xf-yun.com\ndate: ${date}\nGET /v1.1/chat HTTP/1.1`;
            const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, this.apiSecret);
            const signature = CryptoJS.enc.Base64.stringify(signatureSha);
            const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
            const authorization = btoa(authorizationOrigin);
            
            return `${this.url}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=spark-api.xf-yun.com`;
        },
        
        // 连接WebSocket
        async connect(silent = false) {
            // 如果已经有连接且状态正常，则不需要重新连接
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log('WebSocket已连接，无需重新连接');
                return true;
            }
            
            // 关闭现有连接
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            try {
                const url = this.generateAuthUrl();
                this.ws = new WebSocket(url);
                
                // 等待连接打开或失败
                const connectionPromise = new Promise((resolve) => {
                    this.ws.onopen = () => {
                        console.log('WebSocket连接已建立');
                        this.isFirstConnect = false; // 连接成功后更新标记
                        resolve(true);
                    };
                    
                    this.ws.onerror = (error) => {
                        console.error('WebSocket错误:', error);
                        if (!silent && this.responseCallback) {
                            this.responseCallback('连接星火API时出现错误，请稍后再试', 'error');
                        }
                        resolve(false);
                    };
                    
                    this.ws.onclose = () => {
                        console.log('WebSocket连接已关闭');
                        resolve(false);
                    };
                    
                    this.ws.onmessage = (event) => {
                        try {
                            const response = JSON.parse(event.data);
                            this.handleResponse(response);
                        } catch (error) {
                            console.error('解析响应失败:', error);
                            if (!silent && this.responseCallback) {
                                this.responseCallback('抱歉，处理响应时出现错误', 'error');
                            }
                        }
                    };
                    
                    // 设置超时
                    setTimeout(() => {
                        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                            resolve(false);
                        }
                    }, 5000); // 5秒超时
                });
                
                const connected = await connectionPromise;
                return connected;
                
            } catch (error) {
                console.error('创建WebSocket连接失败:', error);
                if (!silent && this.responseCallback) {
                    this.responseCallback('无法连接到星火API，请检查网络连接', 'error');
                }
                return false;
            }
        },
        
        // 处理API响应
        handleResponse(response) {
            if (response.header.code !== 0) {
                console.error('API错误:', response.header.message);
                if (this.responseCallback) {
                    this.responseCallback(`API错误: ${response.header.message}`, 'error');
                }
                return;
            }
            
            // 检查是否有文本内容
            if (response.payload && response.payload.choices && response.payload.choices.text && response.payload.choices.text.length > 0) {
                const content = response.payload.choices.text[0].content;
                
                // 将新内容添加到缓冲区
                this.messageBuffer += content;
                
                // 检查会话状态
                const status = response.payload.choices.status;
                
                // 每次收到新的内容都更新消息，实现持续生成效果
                if (this.responseCallback && this.messageBuffer) {
                    // 传递完整的缓冲区内容和完成状态
                    this.responseCallback(this.messageBuffer, 'assistant', status === 2);
                }
                
                // 如果会话结束，清空缓冲区
                if (status === 2) {
                    this.messageBuffer = '';
                }
            }
        },
        
        // 发送消息到API并等待响应
        async sendMessage(message) {
            return new Promise((resolve, reject) => {
                // 清空消息缓冲区
                this.messageBuffer = '';
                
                // 设置响应超时
                const timeoutId = setTimeout(() => {
                    reject(new Error('AI响应超时，请稍后重试'));
                }, 15000); // 15秒超时
                
                // 临时保存原始回调
                const originalCallback = this.responseCallback;
                
                // 设置新的响应回调
                this.responseCallback = (content, type, isComplete) => {
                    if (type === 'error') {
                        clearTimeout(timeoutId);
                        this.responseCallback = originalCallback;
                        reject(new Error(content));
                        return;
                    }
                    
                    if (type === 'assistant' && isComplete) {
                        clearTimeout(timeoutId);
                        this.responseCallback = originalCallback;
                        resolve({ text: content });
                    }
                };
                
                // 确保WebSocket连接已建立
                this.connect().then(connected => {
                    if (!connected) {
                        clearTimeout(timeoutId);
                        this.responseCallback = originalCallback;
                        reject(new Error('无法连接到AI服务，请检查网络连接'));
                        return;
                    }
                    
                    const data = {
                        header: {
                            app_id: this.appId,
                            uid: this.uid
                        },
                        parameter: {
                            chat: {
                                domain: this.domain,
                                temperature: 0.5,
                                max_tokens: 4096
                            }
                        },
                        payload: {
                            message: {
                                text: [{ role: 'user', content: message }]
                            }
                        }
                    };
                    
                    try {
                        this.ws.send(JSON.stringify(data));
                    } catch (error) {
                        console.error('发送消息失败:', error);
                        clearTimeout(timeoutId);
                        this.responseCallback = originalCallback;
                        reject(new Error('发送消息失败，请稍后再试'));
                    }
                }).catch(error => {
                    clearTimeout(timeoutId);
                    this.responseCallback = originalCallback;
                    reject(error);
                });
            });
        }
    };
} 