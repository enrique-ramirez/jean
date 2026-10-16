#include "fb2k/PCH.h"

#import <Cocoa/Cocoa.h>

#include "core/preferences.h"
#include "fb2k/config_file.h"
#include "fb2k/paths.h"
#include "fb2k/preferences_ids.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"

#include <optional>
#include <string>
#include <vector>

namespace {

using namespace jean;

constexpr CGFloat kContentWidth = 480;
constexpr CGFloat kPageInset = 20;
constexpr CGFloat kRowSpacing = 8;
constexpr CGFloat kGroupSpacing = 20;
constexpr CGFloat kHintSpacing = 2;
constexpr CGFloat kFieldWidth = 240;
constexpr CGFloat kNumberFieldWidth = 80;
constexpr CGFloat kListHeight = 72;
constexpr CGFloat kMessageWidth = 260;

NSString* nsString(const std::string& text) {
    NSString* const made = [[NSString alloc] initWithBytes:text.data()
                                                    length:text.size()
                                                  encoding:NSUTF8StringEncoding];
    return made != nil ? made : @"";
}

std::string stdString(NSString* text) {
    // Cocoa answers NULL for a string it cannot encode.
    const char* const bytes = text.UTF8String;
    return bytes != nullptr ? std::string(bytes) : std::string();
}

// An NSTextView breaks a line with "\n"; the form joins a list with kListLineBreak.
std::string withLineBreaks(const std::string& text, const char* separator) {
    std::string joined;
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '\r' || text[i] == '\n') {
            if (text[i] == '\r' && i + 1 < text.size() && text[i + 1] == '\n')
                ++i;
            joined += separator;
        } else {
            joined += text[i];
        }
    }
    return joined;
}

NSTextField* wrappingLabel(NSString* text, CGFloat width) {
    NSTextField* const label = [NSTextField wrappingLabelWithString:text];
    label.preferredMaxLayoutWidth = width;
    return label;
}

NSTextField* hintLabel(const char* hint) {
    NSTextField* const label = wrappingLabel(nsString(hint), kContentWidth);
    label.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize];
    label.textColor = NSColor.secondaryLabelColor;
    return label;
}

}  // namespace

@interface JeanPreferencesViewController_foo_jean
    : NSViewController <NSTextFieldDelegate, NSTextViewDelegate>
- (instancetype)initWithPage:(PageId)page;
@end

@implementation JeanPreferencesViewController_foo_jean {
    PageId page_;
    std::optional<SettingsEditor> editor_;

    std::vector<NSView*> controls_;
    NSTextField* note_;
    NSTextField* message_;
    NSButton* apply_;
    NSButton* reset_;
}

- (instancetype)initWithPage:(PageId)page {
    self = [super initWithNibName:nil bundle:nil];
    if (self != nil) {
        page_ = page;
        controls_.assign(kSettingEntryCount, nil);
    }
    return self;
}

- (void)loadView {
    NSStackView* const stack = [NSStackView stackViewWithViews:@[]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = kRowSpacing;
    stack.translatesAutoresizingMaskIntoConstraints = NO;

    [self addEntriesTo:stack];

    if (page_ == PageId::jean) {
        note_ = wrappingLabel(@"", kContentWidth);
        [stack addArrangedSubview:note_];
        [stack setCustomSpacing:kGroupSpacing afterView:note_];
    }
    [stack addArrangedSubview:[self buttonRow]];

    NSView* const root = [[NSView alloc] initWithFrame:NSZeroRect];
    [root addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.topAnchor constraintEqualToAnchor:root.topAnchor constant:kPageInset],
        [stack.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:kPageInset],
        [stack.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-kPageInset],
        [stack.bottomAnchor constraintEqualToAnchor:root.bottomAnchor constant:-kPageInset],
        [stack.widthAnchor constraintEqualToConstant:kContentWidth],
    ]];
    self.view = root;

    [self reload];
}

// foobar2000 may keep this controller across openings of the window, or build a new one.
- (void)viewWillAppear {
    [super viewWillAppear];
    [self reload];
}

- (void)addEntriesTo:(NSStackView*)stack {
    NSMutableArray<NSTextField*>* fieldLabels = [NSMutableArray array];
    int lastGroup = kNoGroup;

    for (size_t i = 0; i < kSettingEntryCount; ++i) {
        const SettingEntry& entry = kSettingEntries[i];
        if (entry.page != page_)
            continue;

        if (entry.group != lastGroup && entry.group != kNoGroup) {
            NSTextField* const heading =
                [NSTextField labelWithString:nsString(kSettingGroups[entry.group].caption)];
            heading.font = [NSFont boldSystemFontOfSize:NSFont.systemFontSize];
            if (stack.arrangedSubviews.count > 0)
                [stack setCustomSpacing:kGroupSpacing afterView:stack.arrangedSubviews.lastObject];
            [stack addArrangedSubview:heading];
        }
        lastGroup = entry.group;

        controls_[i] = [self addEntry:entry to:stack labels:fieldLabels];

        if (entry.hint[0] != '\0') {
            [stack setCustomSpacing:kHintSpacing afterView:stack.arrangedSubviews.lastObject];
            [stack addArrangedSubview:hintLabel(entry.hint)];
        }
    }

    CGFloat labelWidth = 0;
    for (NSTextField* label in fieldLabels)
        labelWidth = MAX(labelWidth, label.intrinsicContentSize.width);
    for (NSTextField* label in fieldLabels)
        [label.widthAnchor constraintEqualToConstant:labelWidth].active = YES;
}

- (NSView*)addEntry:(const SettingEntry&)entry
                 to:(NSStackView*)stack
             labels:(NSMutableArray<NSTextField*>*)fieldLabels {
    NSString* const label = nsString(entry.label);

    if (entry.kind == ControlKind::toggle) {
        NSButton* const box = [NSButton checkboxWithTitle:label
                                                   target:self
                                                   action:@selector(edited:)];
        [stack addArrangedSubview:box];
        return box;
    }

    if (entry.kind == ControlKind::lines) {
        NSTextField* const heading = [NSTextField labelWithString:label];
        [stack addArrangedSubview:heading];
        [stack setCustomSpacing:kHintSpacing afterView:heading];

        NSScrollView* const scroll = [[NSScrollView alloc] initWithFrame:NSZeroRect];
        scroll.hasVerticalScroller = YES;
        scroll.borderType = NSBezelBorder;
        scroll.translatesAutoresizingMaskIntoConstraints = NO;

        NSTextView* const text =
            [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, kContentWidth, kListHeight)];
        text.minSize = NSMakeSize(0, kListHeight);
        text.maxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
        text.verticallyResizable = YES;
        text.horizontallyResizable = NO;
        text.autoresizingMask = NSViewWidthSizable;
        text.textContainer.widthTracksTextView = YES;
        text.richText = NO;
        text.font = [NSFont monospacedSystemFontOfSize:NSFont.smallSystemFontSize
                                                weight:NSFontWeightRegular];
        text.automaticQuoteSubstitutionEnabled = NO;
        text.automaticDashSubstitutionEnabled = NO;
        text.automaticTextReplacementEnabled = NO;
        text.automaticSpellingCorrectionEnabled = NO;
        text.automaticLinkDetectionEnabled = NO;
        text.delegate = self;
        text.accessibilityLabel = label;
        scroll.documentView = text;

        [NSLayoutConstraint activateConstraints:@[
            [scroll.widthAnchor constraintEqualToConstant:kContentWidth],
            [scroll.heightAnchor constraintEqualToConstant:kListHeight],
        ]];
        [stack addArrangedSubview:scroll];
        return text;
    }

    NSTextField* const name = [NSTextField labelWithString:label];
    name.alignment = NSTextAlignmentRight;
    [fieldLabels addObject:name];

    NSTextField* const field = [NSTextField textFieldWithString:@""];
    field.delegate = self;
    field.accessibilityLabel = label;
    [field.widthAnchor constraintEqualToConstant:entry.kind == ControlKind::number
                                                     ? kNumberFieldWidth
                                                     : kFieldWidth]
        .active = YES;

    NSStackView* const row = [NSStackView stackViewWithViews:@[ name, field ]];
    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    row.alignment = NSLayoutAttributeFirstBaseline;
    [stack addArrangedSubview:row];
    return field;
}

- (NSView*)buttonRow {
    reset_ = [NSButton buttonWithTitle:nsString(kResetLabel) target:self action:@selector(reset:)];
    apply_ = [NSButton buttonWithTitle:nsString(kApplyLabel) target:self action:@selector(apply:)];

    message_ = wrappingLabel(@"", kMessageWidth);
    message_.textColor = NSColor.systemRedColor;
    message_.hidden = YES;

    NSStackView* const row = [NSStackView stackViewWithViews:@[ reset_, apply_, message_ ]];
    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    row.alignment = NSLayoutAttributeCenterY;
    return row;
}

- (void)reload {
    editor_.emplace(loadSettings, saveSettings,
                    [](const Settings& saved) { return restartNeeded(saved); });
    [self show:editor_->shown()];
    [self showMessage:std::string()];
    [self refreshNote];
    [self refreshApply];
}

- (void)show:(const SettingsForm&)form {
    for (size_t i = 0; i < kSettingEntryCount; ++i) {
        const SettingEntry& entry = kSettingEntries[i];
        if (entry.page != page_)
            continue;

        NSView* const control = controls_[i];
        if (entry.kind == ControlKind::toggle) {
            static_cast<NSButton*>(control).state =
                form.*entry.toggle ? NSControlStateValueOn : NSControlStateValueOff;
        } else if (entry.kind == ControlKind::lines) {
            static_cast<NSTextView*>(control).string =
                nsString(withLineBreaks(form.*entry.text, "\n"));
        } else {
            static_cast<NSTextField*>(control).stringValue = nsString(form.*entry.text);
        }
    }
}

- (SettingsForm)currentForm {
    SettingsForm form = editor_->shown();
    for (size_t i = 0; i < kSettingEntryCount; ++i) {
        const SettingEntry& entry = kSettingEntries[i];
        if (entry.page != page_)
            continue;

        NSView* const control = controls_[i];
        if (entry.kind == ControlKind::toggle) {
            form.*entry.toggle = static_cast<NSButton*>(control).state == NSControlStateValueOn;
        } else if (entry.kind == ControlKind::lines) {
            form.*entry.text =
                withLineBreaks(stdString(static_cast<NSTextView*>(control).string), kListLineBreak);
        } else {
            form.*entry.text = stdString(static_cast<NSTextField*>(control).stringValue);
        }
    }
    return form;
}

- (void)refreshApply {
    apply_.enabled = editor_->differs([self currentForm]);
}

- (void)refreshNote {
    if (note_ == nil)
        return;

    const auto& saved = editor_->saved();
    note_.stringValue = nsString(pageNote(listenerStatus(), runningPort().value_or(saved.port),
                                          displayConfigPath(), restartNeeded(saved)));
}

- (void)showMessage:(const std::string&)text {
    message_.stringValue = nsString(text);
    message_.hidden = text.empty();
}

- (void)edited:(id)sender {
    [self refreshApply];
}

- (void)controlTextDidChange:(NSNotification*)notification {
    [self refreshApply];
}

- (void)textDidChange:(NSNotification*)notification {
    [self refreshApply];
}

- (void)apply:(id)sender {
    const auto outcome = editor_->apply(page_, [self currentForm]);
    if (!outcome.ok()) {
        [self showMessage:outcome.refusal.empty() ? outcome.saveFailure : outcome.refusal];
        return;
    }

    [self show:outcome.form];
    [self showMessage:std::string()];
    [self refreshNote];
    [self refreshApply];
}

- (void)reset:(id)sender {
    [self show:editor_->reset()];
    [self showMessage:std::string()];
    [self refreshApply];
}

@end

namespace {

class MacPreferencesPage : public preferences_page {
public:
    MacPreferencesPage(PageId id, const GUID& guid, const GUID& parent)
        : id_(id), guid_(guid), parent_(parent) {}

    service_ptr instantiate() override {
        return fb2k::wrapNSObject(
            [[JeanPreferencesViewController_foo_jean alloc] initWithPage:id_]);
    }
    const char* get_name() override { return pageName(id_); }
    GUID get_guid() override { return guid_; }
    GUID get_parent_guid() override { return parent_; }

private:
    const PageId id_;
    const GUID guid_;
    const GUID parent_;
};

class JeanPage : public MacPreferencesPage {
public:
    JeanPage() : MacPreferencesPage(PageId::jean, kJeanPageGuid, guid_tools) {}
};

class PermissionsPage : public MacPreferencesPage {
public:
    PermissionsPage()
        : MacPreferencesPage(PageId::permissions, kPermissionsPageGuid, kJeanPageGuid) {}
};

preferences_page_factory_t<JeanPage> g_preferences_page;
preferences_page_factory_t<PermissionsPage> g_permissions_page;

}  // namespace
