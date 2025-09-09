// index.js
const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// إعداد البوت
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildMembers // ✅ إضافة intent للترحيب
  ]
});

// إعداد Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// متغيرات لحفظ البيانات
let giveaways = {};
let greetSettings = {}; // ✅ إعدادات الترحيب لكل سيرفر

// ========== دوال الترحيب ==========
// دالة لتطبيق المتغيرات في رسالة الترحيب
function applyGreetVariables(message, member) {
  return message
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{membercount\}/g, member.guild.memberCount);
}

// دالة لتحويل الوقت من نص إلى ميلي ثانية (للحذف التلقائي)
function parseDelayTime(timeString) {
  const regex = /(\d+)([smh])/g;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(timeString)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': totalMs += value * 1000; break;
      case 'm': totalMs += value * 60 * 1000; break;
      case 'h': totalMs += value * 60 * 60 * 1000; break;
    }
  }

  return totalMs;
}

// ✅ دالة لتنسيق الوقت للعرض
function formatDelayTime(ms) {
  if (ms === 0) return '♾️ Never';
  
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);

  let result = '';
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0) result += `${seconds}s`;

  return result.trim() || '0s';
}

// ========== دوال القيفاوي ==========
// تحميل القيفاويات من قاعدة البيانات
async function loadGiveaways() {
  const { data, error } = await supabase.from('giveaways').select('*');
  if (error) {
    console.error('Error loading giveaways:', error);
  } else {
    giveaways = {};
    data.forEach(g => {
      giveaways[g.id] = g;
    });
  }
}

// حفظ/تحديث قيفاوي
async function saveGiveaway(giveaway) {
  const { error } = await supabase.from('giveaways').upsert(giveaway);
  if (error) console.error('Error saving giveaway:', error);
}

// حذف قيفاوي
async function deleteGiveaway(id) {
  const { error } = await supabase.from('giveaways').delete().eq('id', id);
  if (error) console.error('Error deleting giveaway:', error);
}

// اختيار فائزين عشوائيين
function selectWinners(participants, count) {
  const shuffled = [...participants].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, participants.length));
}

// إنهاء القيفاوي
async function endGiveaway(giveawayId) {
  const giveaway = giveaways[giveawayId];
  if (!giveaway) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);

    let winners = [];
    if (giveaway.participants.length >= giveaway.winners) {
      winners = selectWinners(giveaway.participants, giveaway.winners);
    }

    // إيمبد القيفاوي المنتهي
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTimestamp();

    if (winners.length > 0) {
      const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
      embed.setTitle(`${giveaway.prize}`)
        .setDescription(`🔔 Winner(s): ${winnerMentions}
⚙️ Ending: Ended
↕️ Hosted by: <@${giveaway.hostId}>`)
        .setFooter({ text: `1` });

      await channel.send(`🎊 Congratulations ${winnerMentions}! You won **${giveaway.prize}**! 🎉`);
    } else {
      embed.setTitle(`🎉 ${giveaway.prize} 🎉`)
        .setDescription(`🔔 Winner(s): No valid entries
⚙️ Ending: Ended
↕️ Hosted by: <@${giveaway.hostId}>`)
        .setFooter({ text: `1` });
    }

    await message.edit({ embeds: [embed] });

    // حفظ القيفاوي المنتهي
    const { error } = await supabase.from('ended_giveaways').insert([{
      ...giveaway,
      endedAt: new Date().toISOString(),
      winners_list: winners
    }]);
    if (error) console.error('Error saving ended giveaway:', error);

    // حذف القيفاوي من الجدول
    await deleteGiveaway(giveawayId);
    delete giveaways[giveawayId];

  } catch (error) {
    console.error('Error ending giveaway:', error);
  }
}

// تنسيق الوقت المتبقي
function formatTimeLeft(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0) result += `${seconds}s`;

  return result || '0s';
}

// تحويل الوقت من نص إلى ميلي ثانية
function parseTime(timeString) {
  const regex = /(\d+)([smhd])/g;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(timeString)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': totalMs += value * 1000; break;
      case 'm': totalMs += value * 60 * 1000; break;
      case 'h': totalMs += value * 60 * 60 * 1000; break;
      case 'd': totalMs += value * 24 * 60 * 60 * 1000; break;
    }
  }

  return totalMs;
}

// ========== أحداث البوت ==========
// عند تشغيل البوت
client.once('ready', async () => {
  console.log(`Bot is ready: ${client.user.tag}`);
  await loadGiveaways();

  setInterval(() => {
    const now = Date.now();
    for (const [giveawayId, giveaway] of Object.entries(giveaways)) {
      if (now >= new Date(giveaway.endtime).getTime()) {
        endGiveaway(giveawayId);
      }
    }
  }, 5000);
});

// ✅ event للترحيب عند انضمام عضو جديد
client.on('guildMemberAdd', async (member) => {
  const guildSettings = greetSettings[member.guild.id];
  
  // التحقق من وجود إعدادات الترحيب وأنها مفعلة
  if (!guildSettings || !guildSettings.enabled || !guildSettings.channelId || !guildSettings.message) {
    return;
  }

  try {
    const channel = member.guild.channels.cache.get(guildSettings.channelId);
    if (!channel || !channel.isTextBased()) return;

    // تطبيق المتغيرات على الرسالة
    const welcomeMessage = applyGreetVariables(guildSettings.message, member);

    // إرسال رسالة الترحيب
    const sentMessage = await channel.send(welcomeMessage);

    // حذف الرسالة بعد الوقت المحدد
    if (guildSettings.delAfter > 0) {
      setTimeout(async () => {
        try {
          await sentMessage.delete();
        } catch (error) {
          console.log('Could not delete welcome message:', error.message);
        }
      }, guildSettings.delAfter);
    }

  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
});

// معالجة الأوامر
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ========== أوامر القيفاوي ==========
  if (command === 'gstart') {
    if (!message.member.permissions.has('ManageEvents')) {
      return message.reply('❌ You need Manage Events permission to use this command');
    }

    if (args.length < 3) {
      return message.reply('❌ Usage: `!gstart <time> <winners_count> <prize>`');
    }

    const timeArg = args[0];
    const winnersCount = parseInt(args[1]);
    const prize = args.slice(2).join(' ');
    const duration = parseTime(timeArg);

    if (duration === 0) return message.reply('❌ Invalid time! Use 1h, 30m, 1d');
    if (isNaN(winnersCount) || winnersCount < 1) return message.reply('❌ Winners count must be > 0');

    message.delete().catch(() => {});

    const giveawayId = Date.now().toString();
    const endTime = new Date(Date.now() + duration).toISOString();

    const embed = new EmbedBuilder()
      .setTitle(`${prize}`)
      .setColor('#FFFF00')
      .setDescription(`🔔 React with 🎉 to enter !
⚙️ Ending: <t:${Math.floor((Date.now() + duration) / 1000)}:R>
↕️ Hosted by: <@${message.author.id}>`)
      .setFooter({ text: `🏆 Winners: ${winnersCount}` });

    const giveawayMessage = await message.channel.send({ embeds: [embed] });
    await giveawayMessage.react('🎉');

    giveaways[giveawayId] = {
      id: giveawayId,
      messageId: giveawayMessage.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      host: message.author.username,
      hostId: message.author.id,
      prize,
      winners: winnersCount,
      endtime: endTime,
      participants: []
    };
    await saveGiveaway(giveaways[giveawayId]);
  }

  else if (command === 'gend') {
    if (!message.member.permissions.has('ManageEvents')) return message.reply('❌ Permission needed');
    if (args.length === 0) return message.reply('❌ Usage: `!gend <message_id>`');

    const messageId = args[0];
    const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === messageId);
    if (!giveawayId) return message.reply('❌ No active giveaway found');

    await endGiveaway(giveawayId);
    message.reply('✅ Giveaway ended successfully!');
  }

  else if (command === 'glist') {
    const pageSize = 10;
    const page = parseInt(args[0]) || 1;

    const active = Object.values(giveaways).filter(g => g.guildId === message.guild.id);
    if (active.length === 0) return message.reply('📋 No active giveaways currently');

    const totalPages = Math.ceil(active.length / pageSize);
    if (page < 1 || page > totalPages) {
      return message.reply(`❌ Invalid page. Please choose between 1 and ${totalPages}`);
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const giveawaysPage = active.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
      .setTitle(`📋 Active Giveaways (Page ${page}/${totalPages})`)
      .setColor('#0099ff');

    giveawaysPage.forEach((g, i) => {
      const endTimeMs = new Date(g.endtime).getTime();
      const timeLeft = formatTimeLeft(endTimeMs - Date.now());
      
      embed.addFields({
        name: `${startIndex + i + 1}. ${g.prize}`,
        value: `**Winners:** ${g.winners}\n**Time Left:** ${timeLeft}\n**ID:** ${g.messageId}`,
        inline: false
      });
    });

    let footerText = `Page ${page}/${totalPages} | Today at ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
    if (page < totalPages) {
      footerText = `Next page ➡ !glist ${page + 1} | ${footerText}`;
    }
    embed.setFooter({ text: footerText });

    message.reply({ embeds: [embed] });
  }

  else if (command === 'greroll') {
    if (!message.member.permissions.has('ManageEvents')) return message.reply('❌ Permission needed');
    if (args.length === 0) return message.reply('❌ Usage: `!greroll <message_id>`');

    const messageId = args[0];
    const { data, error } = await supabase.from('ended_giveaways').select('*').eq('messageId', messageId);
    if (error || !data || data.length === 0) return message.reply('❌ No ended giveaway found');

    const giveaway = data[0];
    if (giveaway.participants.length === 0) return message.reply('❌ No participants to reroll');

    const newWinners = selectWinners(giveaway.participants, giveaway.winners);
    const mentions = newWinners.map(id => `<@${id}>`).join(', ');
    message.channel.send(`🔄 Congratulations ${mentions}! You are the new winners of **${giveaway.prize}**!`);
  }

  // ========== أوامر الترحيب ==========
  else if (command === 'greet') {
    if (!message.member.permissions.has('ManageGuild')) {
      return message.reply('❌ You need Manage Server permission to use greet commands');
    }

    const subCommand = args[0]?.toLowerCase();
    const guildId = message.guild.id;

    // إنشاء إعدادات افتراضية إذا لم تكن موجودة
    if (!greetSettings[guildId]) {
      greetSettings[guildId] = {
        enabled: false,
        channelId: null,
        message: 'Welcome {user} to **{server}**! 🎉\nWe now have {membercount} members!',
        delAfter: 0
      };
    }

    const settings = greetSettings[guildId];

    if (subCommand === 'message') {
      if (args.length < 2) {
        return message.reply('❌ Usage: `!greet message <your welcome message>`\n\n**Available variables:**\n`{user}` - Mention the user\n`{username}` - User\'s name\n`{server}` - Server name\n`{membercount}` - Total members');
      }

      const newMessage = args.slice(1).join(' ');
      settings.message = newMessage;
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Welcome Message Updated!')
        .setDescription(`**New Message:**\n${applyGreetVariables(newMessage, message.member)}`)
        .setColor('#00FF00');
      
      message.reply({ embeds: [embed] });
    }

    else if (subCommand === 'channel') {
      settings.channelId = message.channel.id;
      message.reply(`✅ Welcome channel set to ${message.channel}!`);
    }

    else if (subCommand === 'delafter') {
      if (args.length < 2) {
        return message.reply('❌ Usage: `!greet delafter <time>`\nExamples: `30s`, `5m`, `1h`, `0` (never delete)');
      }

      const timeArg = args[1];
      if (timeArg === '0') {
        settings.delAfter = 0;
        return message.reply('✅ Welcome messages will not be auto-deleted!');
      }

      const delayMs = parseDelayTime(timeArg);
      if (delayMs === 0) {
        return message.reply('❌ Invalid time format! Use: `30s`, `5m`, `1h` or `0` for no deletion');
      }

      settings.delAfter = delayMs;
      const delayText = timeArg.replace(/(\d+)([smh])/g, '$1$2');
      message.reply(`✅ Welcome messages will be deleted after **${delayText}**!`);
    }

    else if (subCommand === 'toggle') {
      settings.enabled = !settings.enabled;
      const status = settings.enabled ? '✅ **ENABLED**' : '❌ **DISABLED**';
      
      const embed = new EmbedBuilder()
        .setTitle('🔄 Welcome System Toggled')
        .setDescription(`Welcome system is now ${status}`)
        .setColor(settings.enabled ? '#00FF00' : '#FF0000');
      
      message.reply({ embeds: [embed] });
    }

    else if (subCommand === 'reset') {
      greetSettings[guildId] = {
        enabled: false,
        channelId: null,
        message: 'Welcome {user} to **{server}**! 🎉\nWe now have {membercount} members!',
        delAfter: 0
      };
      
      message.reply('✅ **Welcome system reset successfully!**\nAll settings have been restored to default.');
    }

    // ✅ تحديث أمر status
    else if (subCommand === 'status') {
      const channelMention = settings.channelId ? `<#${settings.channelId}>` : '❌ Not set';
      const statusIcon = settings.enabled ? '🟢' : '🔴';
      const statusText = settings.enabled ? 'Enabled' : 'Disabled';
      const delAfterText = formatDelayTime(settings.delAfter);
      
      const embed = new EmbedBuilder()
        .setTitle(`${statusIcon} Welcome System Status`)
        .setColor(settings.enabled ? '#00FF00' : '#FF6B6B')
        .addFields(
          { 
            name: '⚙️ System Status', 
            value: `${statusIcon} **${statusText}**`, 
            inline: true 
          },
          { 
            name: '📍 Welcome Channel', 
            value: channelMention, 
            inline: true 
          },
          { 
            name: '⏰ Auto Delete', 
            value: delAfterText, 
            inline: true 
          },
          { 
            name: '📝 Current Message', 
            value: `\`\`\`${settings.message}\`\`\``, 
            inline: false 
          },
          { 
            name: '🎭 Message Preview', 
            value: applyGreetVariables(settings.message, message.member), 
            inline: false 
          }
        )
        .setFooter({ 
          text: `Server: ${message.guild.name} • Members: ${message.guild.memberCount}` 
        })
        .setTimestamp();
      
      message.reply({ embeds: [embed] });
    }

    // ✅ إضافة أمر test جديد
    else if (subCommand === 'test') {
      if (!settings.channelId) {
        return message.reply('❌ **Welcome channel not set!**\nUse `!greet channel` first to set a welcome channel.');
      }

      if (!settings.message) {
        return message.reply('❌ **Welcome message not set!**\nUse `!greet message <text>` to set a welcome message.');
      }

      try {
        const channel = message.guild.channels.cache.get(settings.channelId);
        if (!channel || !channel.isTextBased()) {
          return message.reply('❌ **Welcome channel not found or invalid!**\nPlease set a new welcome channel.');
        }

        // تطبيق المتغيرات على الرسالة للاختبار
        const testMessage = applyGreetVariables(settings.message, message.member);
        
        // إرسال رسالة تأكيد
        const confirmEmbed = new EmbedBuilder()
          .setTitle('🧪 Testing Welcome Message...')
          .setDescription(`Sending test welcome message to ${channel}`)
          .setColor('#FFA500');
        
        await message.reply({ embeds: [confirmEmbed] });

        // إرسال رسالة الترحيب التجريبية
        const testPrefix = '🧪 **[TEST MODE]** ';
        const sentMessage = await channel.send(testPrefix + testMessage);

        // حذف الرسالة بعد الوقت المحدد (إذا كان مُعيّن)
        if (settings.delAfter > 0) {
          setTimeout(async () => {
            try {
              await sentMessage.delete();
              // إرسال إشعار بالحذف
              const deleteNotification = await channel.send('🗑️ *Test welcome message deleted automatically*');
              setTimeout(() => deleteNotification.delete().catch(() => {}), 3000);
            } catch (error) {
              console.log('Could not delete test welcome message:', error.message);
            }
          }, settings.delAfter);
        }

        // رسالة تأكيد النجاح
        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Test Completed!')
          .setDescription(`Test welcome message sent to ${channel}${settings.delAfter > 0 ? `\n⏰ Will be auto-deleted in ${formatDelayTime(settings.delAfter)}` : ''}`)
          .setColor('#00FF00');
        
        setTimeout(() => {
          message.channel.send({ embeds: [successEmbed] });
        }, 1000);

      } catch (error) {
        console.error('Error testing welcome message:', error);
        message.reply('❌ **Error testing welcome message!**\nPlease check the welcome channel settings.');
      }
    }

    else {
      const embed = new EmbedBuilder()
        .setTitle('🎉 Welcome System Commands')
        .setColor('#0099FF')
        .setDescription('Available greet commands:')
        .addFields(
          { name: '💬 !greet message `<text>`', value: 'Set the welcome message', inline: false },
          { name: '📍 !greet channel', value: 'Set current channel for welcomes', inline: false },
          { name: '⏰ !greet delafter `<time>`', value: 'Set auto-delete delay (30s, 5m, 1h, 0)', inline: false },
          { name: '🔄 !greet toggle', value: 'Enable/disable welcome system', inline: false },
          { name: '📊 !greet status', value: 'Show detailed welcome settings', inline: false },
          { name: '🧪 !greet test', value: 'Test welcome message in current setup', inline: false },
          { name: '🗑️ !greet reset', value: 'Reset all welcome settings', inline: false }
        )
        .setFooter({ text: 'Variables: {user} {username} {server} {membercount}' });
      
      message.reply({ embeds: [embed] });
    }
  }

  // ========== أمر المساعدة ==========
  else if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands - Help Center')
      .setColor('#FF0000')
      .setDescription('All available bot commands organized by category:')
      .addFields(
        {
          name: '🎉 **GIVEAWAY COMMANDS**',
          value: `**🚀 !gstart** \`<time>\` \`<winners>\` \`<prize>\` - Start giveaway
**🗑️ !gend** \`<message_id>\` - End giveaway manually
**📋 !glist** \`[page]\` - List active giveaways
**🔄 !greroll** \`<message_id>\` - Reroll giveaway winners`,
          inline: false
        },
        {
          name: '👋 **WELCOME COMMANDS**',
          value: `**💬 !greet message** \`<text>\` - Set welcome message
**📍 !greet channel** - Set welcome channel (current)
**⏰ !greet delafter** \`<time>\` - Auto-delete delay
**🔄 !greet toggle** - Enable/disable welcomes
**📊 !greet status** - Show detailed welcome config
**🧪 !greet test** - Test welcome message
**🗑️ !greet reset** - Reset welcome settings`,
          inline: false
        },
        {
          name: '📝 **WELCOME VARIABLES**',
          value: '`{user}` = @mention • `{username}` = name • `{server}` = server name • `{membercount}` = member count',
          inline: false
        },
        {
          name: '⏰ **TIME FORMATS**',
          value: '`s` = seconds • `m` = minutes • `h` = hours • `d` = days\nExample: `1h30m` = 1 hour 30 minutes',
          inline: false
        }
      )
      .setFooter({ text: `Made with ❤️ | Need help? Contact server admins` });

    message.reply({ embeds: [helpEmbed] });
  }
});

// تفاعل المستخدمين مع القيفاويات
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === reaction.message.id);
  if (!giveawayId) return;

  const giveaway = giveaways[giveawayId];
  if (!giveaway.participants.includes(user.id)) {
    giveaway.participants.push(user.id);
    await saveGiveaway(giveaway);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === reaction.message.id);
  if (!giveawayId) return;

  const giveaway = giveaways[giveawayId];
  giveaway.participants = giveaway.participants.filter(id => id !== user.id);
  await saveGiveaway(giveaway);
});

// تسجيل الدخول
client.login(process.env.DISCORD_TOKEN);
