/*
 * Created on Mon Jan 25 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { Chat } from './chat';
import { ChatType } from './chat-type';
import { ChatContent } from './content';

/**
 * Build Chat object
 */
export class ChatBuilder<T extends ChatType> {
  private _attachment: Record<string, unknown>;
  private _text: string;

  constructor(private _type: T) {
    this._attachment = {};
    this._text = '';
  }

  /**
   * Append text or chat content
   *
   * @param {string | ChatContent} content
   * @return {this}
   */
  append(content: string | ChatContent): this {
    if (typeof content === 'string') {
      this._text += content;
      return this;
    }


    return this;
  }

  /**
   * Build into chat object
   *
   * @return {Chat}
   */
  build(): Chat {
    const chat: Chat = {
      type: this._type,
      text: this._text,
      attachment: this._attachment,
    };

    return chat;
  }
}
