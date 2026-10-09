# The test binary, one object per source, for scripts/test.sh. It passes ROOT, OUT, CXX,
# CXXFLAGS, CORE_CXXFLAGS, LDFLAGS, SOURCES, LIBS and FLAGS;
# nothing here is meant to be run by hand.
#
# -MMD writes each object's header list beside it, so editing a header rebuilds what includes
# it. FLAGS is a file test.sh rewrites only when the flags change, so a new define or include
# path rebuilds everything.

OBJECTS := $(patsubst $(ROOT)/%.cpp,$(OUT)/obj/%.o,$(SOURCES))

$(OUT)/foo_jean_tests: $(OBJECTS) $(LIBS)
	$(CXX) $(LDFLAGS) $(OBJECTS) $(LIBS) -o $@

$(OUT)/obj/src/core/%.o: CXXFLAGS += $(CORE_CXXFLAGS)

$(OUT)/obj/%.o: $(ROOT)/%.cpp $(FLAGS)
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

-include $(OBJECTS:.o=.d)
