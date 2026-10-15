# The test binary, one object per source, for scripts/test.sh. It passes ROOT, OUT, CXX,
# CXXFLAGS, CORE_CXXFLAGS, LDFLAGS, SOURCES, LIBS and FLAGS, and PCH_HEADER and PCH_FLAGS when
# the suite builds with a precompiled header; nothing here is meant to be run by hand.
#
# -MMD writes each object's header list beside it, so editing a header rebuilds what includes
# it. FLAGS is a file test.sh rewrites only when the flags change, so a new define or include
# path rebuilds everything.

OBJECTS := $(patsubst $(ROOT)/%.cpp,$(OUT)/obj/%.o,$(SOURCES))

ifneq ($(PCH_HEADER),)
PCH := $(OUT)/pch/precompiled.pch
PCH_OBJECT := $(OUT)/pch/precompiled.o
PCH_USERS := $(filter-out $(OUT)/obj/tests/main.o,$(OBJECTS))
endif

$(OUT)/foo_jean_tests: $(OBJECTS) $(PCH_OBJECT) $(LIBS)
	$(CXX) $(LDFLAGS) $(OBJECTS) $(PCH_OBJECT) $(LIBS) -o $@

$(OUT)/obj/src/core/%.o: CXXFLAGS += $(CORE_CXXFLAGS)

$(OUT)/obj/%.o: $(ROOT)/%.cpp $(FLAGS)
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $(PCH_USE) -MMD -MP -c $< -o $@

ifneq ($(PCH_HEADER),)
$(PCH_USERS): $(PCH)
$(PCH_USERS): PCH_USE = -include-pch $(PCH)

$(PCH): $(PCH_HEADER) $(FLAGS)
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $(PCH_FLAGS) -MMD -MP -MF $@.d -MT $@ -x c++-header $< -o $@

# clang's -fpch-codegen leaves the header's inline functions to this one object. clang compiles
# it from the .pch alone and warns about each preprocessor flag in CXXFLAGS it did not use.
$(PCH_OBJECT): $(PCH)
	$(CXX) $(CXXFLAGS) -Wno-unused-command-line-argument -c $< -o $@
endif

-include $(OBJECTS:.o=.d) $(if $(PCH),$(PCH).d)
