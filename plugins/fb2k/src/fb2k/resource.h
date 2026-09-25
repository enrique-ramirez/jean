#ifndef FOO_JEAN_RESOURCE_H
#define FOO_JEAN_RESOURCE_H

// Included by preferences.rc as well as by C++, so classic include guards rather than
// #pragma once: rc.exe's preprocessor is not the compiler's.

#define IDC_STATIC (-1)

#define IDD_PREFERENCES 101
#define IDD_PERMISSIONS 102

#define IDC_PORT 1001
#define IDC_BIND 1002
#define IDC_ORIGINS 1005
#define IDC_FIELDS 1006
#define IDC_CONFIG_PATH 1007
#define IDC_WRITE_PLAYLISTS 1011
#define IDC_CONTROL_PLAYBACK 1012
#define IDC_CHANGE_OUTPUT 1013
#define IDC_STREAMING_ENABLED 1014
#define IDC_MAX_AUTOPLAYLISTS 1015
#define IDC_HOSTS 1016

#endif  // FOO_JEAN_RESOURCE_H
